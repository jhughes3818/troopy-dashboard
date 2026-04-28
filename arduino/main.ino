
#include <ArduinoBLE.h>
#include <Crypto.h>
#include <AES.h>
#include <WiFiS3.h>
#include <WiFiSSLClient.h>
#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <math.h>
#include <string.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#include "arduino_secrets.h"

// ============================================================
// CONFIG
// ============================================================

static const char HOST[] = "troopy-dashboard.vercel.app";
static const int HTTPS_PORT = 443;
static const char PATH[] = "/api/victron";
static const char DEVICE_ID[] = "troopy-smartshunt";

static const unsigned long SAMPLE_INTERVAL_MS = 15000;        // store one reading every 15s
static const unsigned long UPLOAD_INTERVAL_MS = 25000;        // attempt upload every 25s when internet looks usable
static const unsigned long TIME_SYNC_RETRY_INTERVAL_MS = 60000;

static const unsigned long BASE_BACKOFF_MS = 5000;
static const unsigned long MAX_BACKOFF_MS = 300000;           // 5 min

// BLE data can be briefly interrupted while network code runs, so allow a little staleness.
static const unsigned long LATEST_DATA_STALE_MS = 60000;

// Keep batches deliberately small. Bigger batches increase blocking time during TLS/HTTP.
static const int MAX_BATCH_SIZE = 12;
static const bool REQUIRE_TIME_SYNC_BEFORE_LOGGING = true;

// Wi-Fi state machine settings. These keep connection attempts bounded.
static const unsigned long WIFI_CONNECT_TIMEOUT_MS = 12000;
static const unsigned long WIFI_RETRY_CYCLE_DELAY_MS = 5000;
static const unsigned long WIFI_FORCED_RESET_COOLDOWN_MS = 60000;
static const unsigned long UPLOAD_STALL_RESET_MS = 30UL * 60UL * 1000UL; // reset Wi-Fi if uploads fail for 30 min while queue grows
static const unsigned long WIFI_POST_RESET_SETTLE_MS = 1500;
static const unsigned long WIFI_MAX_CONNECTED_WITHOUT_INTERNET_MS = 5UL * 60UL * 1000UL;
static const unsigned long MIN_QUEUE_FOR_STALL_RESET = 5;
static const unsigned long MAX_UPLOAD_FAILURES_BEFORE_WIFI_RESET = 5;

// Internet gate settings. This prevents the Arduino from trying a full HTTPS upload just
// because it has joined Wi-Fi, before Starlink/NBN/etc has real internet connectivity.
static const unsigned long INTERNET_CHECK_INTERVAL_MS = 15000;
static const unsigned long INTERNET_OK_TTL_MS = 45000;
static const unsigned long INTERNET_FAIL_BACKOFF_MS = 20000;
static const unsigned long HTTP_TIMEOUT_MS = 4500;
static const int INTERNET_CHECK_PORT = 443;

// Victron BLE target
const char* TARGET_MAC = "c6:08:49:3f:52:6f";

// Victron advertisement key
uint8_t victronKey[16] = {
  0xee, 0xe0, 0x79, 0x41,
  0xed, 0xb0, 0x71, 0x02,
  0xa5, 0xb8, 0xb5, 0x91,
  0xad, 0xb2, 0x73, 0x86
};

// ============================================================
// WIFI CREDS
// ============================================================

struct WifiCredential {
  const char* ssid;
  const char* password;
};

WifiCredential wifiCreds[] = {
  { SECRET_WIFI_SSID_1, SECRET_WIFI_PASS_1 },
  { SECRET_WIFI_SSID_2, SECRET_WIFI_PASS_2 },
};

static const int WIFI_CRED_COUNT = sizeof(wifiCreds) / sizeof(wifiCreds[0]);

// ============================================================
// TIME
// ============================================================

WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", 0, 60000);

bool timeSynced = false;
unsigned long lastTimeSyncAttemptMs = 0;
uint64_t lastKnownEpochMsBase = 0;
unsigned long lastKnownEpochMsAtMillis = 0;

// ============================================================
// NETWORK
// ============================================================

WiFiSSLClient sslClient;
HttpClient httpClient(sslClient, HOST, HTTPS_PORT);
WiFiSSLClient internetProbeClient;

// ============================================================
// BLE / CRYPTO
// ============================================================

AES128 aes;

// ============================================================
// TEMPERATURE SENSORS
// ============================================================

#define ONE_WIRE_BUS 2

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensors(&oneWire);

// Outside
DeviceAddress outsideTempSensor = { 0x28, 0x7C, 0x14, 0x87, 0x00, 0xE1, 0x1B, 0xCB };

// Inside
DeviceAddress insideTempSensor  = { 0x28, 0x2B, 0x72, 0xA7, 0x00, 0x00, 0x00, 0x91 };

// ============================================================
// DATA STRUCTURES
// ============================================================

struct BatteryData {
  bool valid = false;
  float voltage = NAN;
  float current = NAN;
  float soc = NAN;
  float power = NAN;
  float auxVoltage = NAN;
  float ttgDays = NAN;
};

struct TelemetryRecord {
  float voltage;
  float current;
  float soc;
  float aux_voltage;
  float ttg_days;
  float inside_temp_c;
  float outside_temp_c;
  uint32_t timestamp_s;
};

struct QueueHeader {
  uint32_t magic;
  uint16_t version;
  uint16_t head;
  uint16_t tail;
  uint16_t count;
};

// ============================================================
// EEPROM QUEUE
// ============================================================

static const uint32_t EEPROM_MAGIC = 0x54524F50; // "TROP"
static const uint16_t EEPROM_VERSION = 3;

static const int HEADER_ADDR = 0;
static const int RECORDS_ADDR = sizeof(QueueHeader);
static const int RECORD_SIZE = sizeof(TelemetryRecord);
static const int EEPROM_TOTAL_BYTES = 8192;
static const int MAX_QUEUE_RECORDS = (EEPROM_TOTAL_BYTES - RECORDS_ADDR) / RECORD_SIZE;
static const int EEPROM_BYTES_NEEDED = RECORDS_ADDR + (MAX_QUEUE_RECORDS * RECORD_SIZE);

QueueHeader queueHeader;

// ============================================================
// RUNTIME STATE
// ============================================================

unsigned long lastSampleMs = 0;
unsigned long lastUploadMs = 0;
unsigned long nextUploadAttemptMs = 0;
unsigned long consecutiveFailures = 0;
unsigned long lastSuccessfulUploadMs = 0;
unsigned long lastWifiForcedResetMs = 0;
unsigned long wifiConnectedSinceMs = 0;
bool authFailure = false;

BatteryData latestBatteryData;
unsigned long latestBatteryDataAtMs = 0;

// ============================================================
// WIFI / INTERNET STATE MACHINE
// ============================================================

enum WifiManagerState {
  WIFI_IDLE,
  WIFI_CONNECTING,
  WIFI_WAIT_BETWEEN_CYCLES
};

WifiManagerState wifiState = WIFI_IDLE;
int wifiCredIndex = 0;
unsigned long wifiStateStartedMs = 0;
unsigned long wifiCycleRetryAtMs = 0;
bool wifiWasConnected = false;

bool internetUsable = false;
unsigned long lastInternetOkMs = 0;
unsigned long nextInternetCheckMs = 0;
unsigned long internetCheckStartedMs = 0;
bool internetCheckInProgress = false;

// ============================================================
// EEPROM HELPERS
// ============================================================

template <typename T>
void eepromWriteObject(int addr, const T& obj) {
  EEPROM.put(addr, obj);
}

template <typename T>
void eepromReadObject(int addr, T& obj) {
  EEPROM.get(addr, obj);
}

int queueRecordAddr(int index) {
  return RECORDS_ADDR + (index * RECORD_SIZE);
}

void saveQueueHeader() {
  eepromWriteObject(HEADER_ADDR, queueHeader);
}

void loadOrInitQueue() {
  eepromReadObject(HEADER_ADDR, queueHeader);
  tempSensors.begin();

  Serial.print("Temperature sensors found: ");
  Serial.println(tempSensors.getDeviceCount());

  bool valid =
    queueHeader.magic == EEPROM_MAGIC &&
    queueHeader.version == EEPROM_VERSION &&
    queueHeader.head < MAX_QUEUE_RECORDS &&
    queueHeader.tail < MAX_QUEUE_RECORDS &&
    queueHeader.count <= MAX_QUEUE_RECORDS;

  if (!valid) {
    queueHeader.magic = EEPROM_MAGIC;
    queueHeader.version = EEPROM_VERSION;
    queueHeader.head = 0;
    queueHeader.tail = 0;
    queueHeader.count = 0;
    saveQueueHeader();
    Serial.println("EEPROM queue initialised.");
  } else {
    Serial.print("EEPROM queue loaded. count=");
    Serial.println(queueHeader.count);
  }
}

bool queueIsEmpty() {
  return queueHeader.count == 0;
}

bool queueIsFull() {
  return queueHeader.count >= MAX_QUEUE_RECORDS;
}

bool queuePeek(int offsetFromHead, TelemetryRecord& out) {
  if (offsetFromHead < 0 || offsetFromHead >= queueHeader.count) return false;
  int idx = (queueHeader.head + offsetFromHead) % MAX_QUEUE_RECORDS;
  eepromReadObject(queueRecordAddr(idx), out);
  return true;
}

bool queuePush(const TelemetryRecord& rec) {
  if (queueIsFull()) return false;

  eepromWriteObject(queueRecordAddr(queueHeader.tail), rec);
  queueHeader.tail = (queueHeader.tail + 1) % MAX_QUEUE_RECORDS;
  queueHeader.count++;
  saveQueueHeader();
  return true;
}

bool queuePopOne() {
  if (queueIsEmpty()) return false;

  queueHeader.head = (queueHeader.head + 1) % MAX_QUEUE_RECORDS;
  queueHeader.count--;
  saveQueueHeader();
  return true;
}

int queuePopMany(int n) {
  int popped = 0;
  while (popped < n && !queueIsEmpty()) {
    queuePopOne();
    popped++;
  }
  return popped;
}

void queuePushWithOverwrite(const TelemetryRecord& rec) {
  if (queuePush(rec)) return;

  Serial.println("Queue full, dropping oldest record to make room.");
  queuePopOne();
  if (!queuePush(rec)) {
    Serial.println("Failed to push even after dropping oldest.");
  }
}

// ============================================================
// TIME HELPERS
// ============================================================

void trySyncTime() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!internetUsable) return;

  if (!timeClient.isTimeSet()) {
    timeClient.begin();
  }

  if (timeClient.update()) {
    unsigned long epochSeconds = timeClient.getEpochTime();
    lastKnownEpochMsBase = (uint64_t)epochSeconds * 1000ULL;
    lastKnownEpochMsAtMillis = millis();
    timeSynced = true;

    Serial.print("Time synced. Epoch seconds: ");
    Serial.println(epochSeconds);
  } else {
    Serial.println("Time sync attempt failed.");
  }
}

uint64_t nowUnixMs() {
  if (!timeSynced) return 0;
  return lastKnownEpochMsBase + (uint64_t)(millis() - lastKnownEpochMsAtMillis);
}

uint32_t nowUnixSeconds() {
  uint64_t nowMs = nowUnixMs();
  if (nowMs == 0) return 0;
  return (uint32_t)(nowMs / 1000ULL);
}

// ============================================================
// WIFI / INTERNET HELPERS
// ============================================================

void startWifiConnectAttempt(int credIndex) {
  if (credIndex < 0 || credIndex >= WIFI_CRED_COUNT) return;

  Serial.print("Connecting to SSID: ");
  Serial.println(wifiCreds[credIndex].ssid);

  WiFi.disconnect();
  WiFi.begin(wifiCreds[credIndex].ssid, wifiCreds[credIndex].password);

  wifiState = WIFI_CONNECTING;
  wifiStateStartedMs = millis();
}

void resetWifiManager() {
  wifiState = WIFI_IDLE;
  wifiCredIndex = 0;
  wifiStateStartedMs = 0;
  wifiCycleRetryAtMs = 0;
}

void forceWifiReset(const char* reason) {
  unsigned long now = millis();

  if (lastWifiForcedResetMs != 0 && now - lastWifiForcedResetMs < WIFI_FORCED_RESET_COOLDOWN_MS) {
    Serial.print("Wi-Fi forced reset skipped due to cooldown. Reason was: ");
    Serial.println(reason);
    return;
  }

  Serial.print("Forcing Wi-Fi reset: ");
  Serial.println(reason);

  sslClient.stop();
  internetProbeClient.stop();
  WiFi.disconnect();
  delay(WIFI_POST_RESET_SETTLE_MS);

  lastWifiForcedResetMs = millis();
  wifiWasConnected = false;
  wifiConnectedSinceMs = 0;
  internetUsable = false;
  internetCheckInProgress = false;
  lastInternetOkMs = 0;
  nextInternetCheckMs = 0;
  nextUploadAttemptMs = 0;

  resetWifiManager();
  serviceWifi();
}

void markInternetOffline() {
  if (internetUsable) {
    Serial.println("Internet no longer marked usable.");
  }

  internetUsable = false;
  internetCheckInProgress = false;
  internetProbeClient.stop();
}

void markInternetOnline() {
  if (!internetUsable) {
    Serial.println("Internet is usable.");
  }

  internetUsable = true;
  lastInternetOkMs = millis();
  internetCheckInProgress = false;
  internetProbeClient.stop();
}

void serviceWifi() {
  int status = WiFi.status();

  if (status == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      wifiConnectedSinceMs = millis();
      Serial.print("Connected to Wi-Fi. IP: ");
      Serial.println(WiFi.localIP());
      nextInternetCheckMs = 0;
    }
    resetWifiManager();
    return;
  }

  if (wifiWasConnected) {
    wifiWasConnected = false;
    wifiConnectedSinceMs = 0;
    Serial.println("Wi-Fi disconnected.");
    markInternetOffline();
  }

  switch (wifiState) {
    case WIFI_IDLE:
      wifiCredIndex = 0;
      startWifiConnectAttempt(wifiCredIndex);
      break;

    case WIFI_CONNECTING:
      if (millis() - wifiStateStartedMs >= WIFI_CONNECT_TIMEOUT_MS) {
        Serial.print("Wi-Fi attempt timed out for SSID: ");
        Serial.println(wifiCreds[wifiCredIndex].ssid);

        wifiCredIndex++;

        if (wifiCredIndex < WIFI_CRED_COUNT) {
          startWifiConnectAttempt(wifiCredIndex);
        } else {
          Serial.println("Finished Wi-Fi cycle. Waiting before retrying all networks.");
          wifiState = WIFI_WAIT_BETWEEN_CYCLES;
          wifiCycleRetryAtMs = millis() + WIFI_RETRY_CYCLE_DELAY_MS;
        }
      }
      break;

    case WIFI_WAIT_BETWEEN_CYCLES:
      if ((long)(millis() - wifiCycleRetryAtMs) >= 0) {
        wifiCredIndex = 0;
        startWifiConnectAttempt(wifiCredIndex);
      }
      break;
  }
}

void serviceInternetGate() {
  if (WiFi.status() != WL_CONNECTED) {
    markInternetOffline();
    return;
  }

  if (internetUsable && millis() - lastInternetOkMs < INTERNET_OK_TTL_MS) {
    return;
  }

  if (!internetCheckInProgress && millis() < nextInternetCheckMs) {
    return;
  }

  if (!internetCheckInProgress) {
    Serial.println("Checking internet reachability...");
    internetCheckInProgress = true;
    internetCheckStartedMs = millis();
    internetProbeClient.stop();

    // This can still block briefly inside WiFiSSLClient, but it is bounded by setTimeout()
    // and is much cheaper than a full JSON upload attempt.
    internetProbeClient.setTimeout(HTTP_TIMEOUT_MS);
    bool connected = internetProbeClient.connect(HOST, INTERNET_CHECK_PORT);

    if (connected) {
      markInternetOnline();
      nextInternetCheckMs = millis() + INTERNET_CHECK_INTERVAL_MS;
    } else {
      Serial.println("Internet check failed; will not upload yet.");
      markInternetOffline();
      nextInternetCheckMs = millis() + INTERNET_FAIL_BACKOFF_MS;
    }
    return;
  }

  if (millis() - internetCheckStartedMs >= HTTP_TIMEOUT_MS) {
    Serial.println("Internet check timed out.");
    markInternetOffline();
    nextInternetCheckMs = millis() + INTERNET_FAIL_BACKOFF_MS;
  }
}

// ============================================================
// BACKOFF
// ============================================================

void resetBackoff() {
  consecutiveFailures = 0;
  nextUploadAttemptMs = 0;
}

void bumpBackoff() {
  consecutiveFailures++;

  Serial.print("Consecutive upload failures: ");
  Serial.println(consecutiveFailures);

  if (consecutiveFailures >= MAX_UPLOAD_FAILURES_BEFORE_WIFI_RESET) {
    forceWifiReset("too many consecutive upload failures");
    consecutiveFailures = 0;
  }

  unsigned long delayMs = BASE_BACKOFF_MS;
  for (unsigned long i = 1; i < consecutiveFailures; i++) {
    if (delayMs >= MAX_BACKOFF_MS / 2) {
      delayMs = MAX_BACKOFF_MS;
      break;
    }
    delayMs *= 2;
  }

  if (delayMs > MAX_BACKOFF_MS) delayMs = MAX_BACKOFF_MS;

  nextUploadAttemptMs = millis() + delayMs;

  Serial.print("Backoff set to ");
  Serial.print(delayMs);
  Serial.println(" ms");
}

// ============================================================
// VICTRON PARSING HELPERS
// ============================================================

uint16_t readU16LE(const uint8_t* p) {
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

float parseTimeToGoDays(const uint8_t* output, bool& inf_ttg) {
  uint16_t ttgMins = readU16LE(&output[0]);
  if (ttgMins == 0xFFFF) {
    inf_ttg = true;
    return NAN;
  }
  inf_ttg = false;
  return ttgMins / 60.0f / 24.0f;
}

float parseBatteryVoltage(const uint8_t* output, bool& na_batV) {
  bool neg = (output[3] & 0x80) >> 7;
  int32_t batt_mV10 = ((output[3] & 0x7F) << 8) | output[2];
  if (batt_mV10 == 0x7FFF) {
    na_batV = true;
    return NAN;
  }
  if (neg) batt_mV10 -= 32768;
  na_batV = false;
  return batt_mV10 / 100.0f;
}

float parseAuxVoltage(const uint8_t* output, bool& na_aux) {
  bool neg = (output[7] & 0x80) >> 7;
  int32_t aux_mV10 = ((output[7] & 0x7F) << 8) | output[6];
  if (aux_mV10 == 0x7FFF) {
    na_aux = true;
    return NAN;
  }
  if (neg) aux_mV10 -= 32768;
  na_aux = false;
  return aux_mV10 / 100.0f;
}

float parseBatteryCurrent(const uint8_t* output, bool& na_batA) {
  bool neg = (output[10] & 0x80) >> 7;

  int32_t mA =
      ((output[8] & 0xFC) >> 2) +
      (((output[9] & 0x03) << 6)) |
      ((((output[9] & 0xFC) >> 2) + ((output[10] & 0x03) << 6)) << 8) |
      ((((output[10] & 0x7C) >> 2)) << 16);

  if (mA == 0x1FFFFF) {
    na_batA = true;
    return NAN;
  }

  if (neg) mA -= 2097152;

  na_batA = false;
  return mA / 1000.0f;
}

float parseStateOfCharge(const uint8_t* output, bool& na_soc) {
  uint16_t soc01 =
      ((output[13] & 0xF0) >> 4) |
      ((output[14] & 0x0F) << 4) |
      ((output[14] & 0x30) << 4);

  if (soc01 == 0x03FF || soc01 > 1000) {
    na_soc = true;
    return NAN;
  }

  na_soc = false;
  return soc01 / 10.0f;
}

float readTempC(DeviceAddress address) {
  float temp = tempSensors.getTempC(address);

  if (temp == DEVICE_DISCONNECTED_C || temp < -100.0f) {
    return NAN;
  }

  return temp;
}

// ============================================================
// JSON HELPERS
// ============================================================

void addRecordToJson(JsonObject obj, const TelemetryRecord& r) {
  obj["device_id"] = DEVICE_ID;

  if (isfinite(r.voltage)) obj["voltage"] = r.voltage; else obj["voltage"] = nullptr;
  if (isfinite(r.current)) obj["current"] = r.current; else obj["current"] = nullptr;
  if (isfinite(r.soc)) obj["soc"] = r.soc; else obj["soc"] = nullptr;

  float power = NAN;
  if (isfinite(r.voltage) && isfinite(r.current)) {
    power = r.voltage * r.current;
  }
  if (isfinite(power)) obj["power"] = power; else obj["power"] = nullptr;

  if (isfinite(r.aux_voltage)) obj["aux_voltage"] = r.aux_voltage; else obj["aux_voltage"] = nullptr;
  if (isfinite(r.ttg_days)) obj["ttg_days"] = r.ttg_days; else obj["ttg_days"] = nullptr;
  if (isfinite(r.inside_temp_c)) obj["inside_temp_c"] = r.inside_temp_c; else obj["inside_temp_c"] = nullptr;
  if (isfinite(r.outside_temp_c)) obj["outside_temp_c"] = r.outside_temp_c; else obj["outside_temp_c"] = nullptr;

  obj["timestamp_ms"] = (uint64_t)r.timestamp_s * 1000ULL;
}

// ============================================================
// HTTP HELPERS
// ============================================================

bool sendJsonPayload(const String& body, int& statusCode, String& responseBody) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("No Wi-Fi.");
    return false;
  }

  if (!internetUsable) {
    Serial.println("Wi-Fi connected, but internet not confirmed. Skipping upload.");
    return false;
  }

  sslClient.stop();
  sslClient.setTimeout(HTTP_TIMEOUT_MS);
  httpClient.setTimeout(HTTP_TIMEOUT_MS);

  httpClient.beginRequest();
  httpClient.post(PATH);
  httpClient.sendHeader("Content-Type", "application/json");
  httpClient.sendHeader("x-ingest-key", SECRET_INGEST_API_KEY);
  httpClient.sendHeader("Content-Length", body.length());
  httpClient.beginBody();
  httpClient.print(body);
  httpClient.endRequest();

  statusCode = httpClient.responseStatusCode();
  responseBody = httpClient.responseBody();

  Serial.print("HTTP status: ");
  Serial.println(statusCode);
  Serial.print("Response: ");
  Serial.println(responseBody);

  if (statusCode <= 0) {
    markInternetOffline();
  } else {
    markInternetOnline();
  }

  return true;
}

int buildBatchPayload(TelemetryRecord* outRecords, int maxRecords, String& outBody) {
  int available = queueHeader.count;
  int n = available < maxRecords ? available : maxRecords;
  if (n <= 0) return 0;

  for (int i = 0; i < n; i++) {
    if (!queuePeek(i, outRecords[i])) {
      return 0;
    }
  }

  StaticJsonDocument<8192> doc;
  JsonArray records = doc.createNestedArray("records");

  for (int i = 0; i < n; i++) {
    JsonObject obj = records.createNestedObject();
    addRecordToJson(obj, outRecords[i]);
  }

  outBody = "";
  serializeJson(doc, outBody);

  while (outBody.length() > 12000 && n > 1) {
    n--;

    doc.clear();
    JsonArray smallerRecords = doc.createNestedArray("records");
    for (int i = 0; i < n; i++) {
      JsonObject obj = smallerRecords.createNestedObject();
      addRecordToJson(obj, outRecords[i]);
    }

    outBody = "";
    serializeJson(doc, outBody);
  }

  return n;
}

bool flushQueuedRecords() {
  if (queueIsEmpty()) return true;
  if (authFailure) return false;
  if (WiFi.status() != WL_CONNECTED) return false;
  if (!internetUsable) return false;
  if (nextUploadAttemptMs != 0 && millis() < nextUploadAttemptMs) return false;

  TelemetryRecord batch[MAX_BATCH_SIZE];
  String body;
  int batchCount = buildBatchPayload(batch, MAX_BATCH_SIZE, body);

  if (batchCount <= 0) {
    Serial.println("No batch could be built.");
    return false;
  }

  int statusCode = 0;
  String responseBody;

  if (!sendJsonPayload(body, statusCode, responseBody)) {
    bumpBackoff();
    return false;
  }

  if (statusCode >= 200 && statusCode < 300) {
    int popped = queuePopMany(batchCount);
    Serial.print("Uploaded and removed records: ");
    Serial.println(popped);
    lastSuccessfulUploadMs = millis();
    resetBackoff();
    return true;
  }

  if (statusCode == 401) {
    authFailure = true;
    Serial.println("AUTH FAILURE: invalid ingest key. Uploads halted.");
    return false;
  }

  if (statusCode == 400) {
    Serial.println("400 from server. Dropping oldest queued record.");
    queuePopOne();
    resetBackoff();
    return false;
  }

  if (statusCode == 413) {
    Serial.println("413 payload too large. Will retry with backoff.");
    bumpBackoff();
    return false;
  }

  if (statusCode >= 500 || statusCode <= 0) {
    Serial.println("Server/network error. Will retry later.");
    bumpBackoff();
    return false;
  }

  Serial.println("Unexpected HTTP status. Will retry later.");
  bumpBackoff();
  return false;
}

// ============================================================
// VICTRON BLE READ
// ============================================================

bool decodeVictronDevice(BLEDevice& device, BatteryData& result) {
  if (!device) return false;
  if (device.address() != TARGET_MAC) return false;

  int len = device.manufacturerDataLength();
  if (len <= 0 || len > 64) return false;

  uint8_t data[64];
  int actualLen = device.manufacturerData(data, len);

  if (actualLen < 25) return false;
  if (!(data[0] == 0xE1 && data[1] == 0x02)) return false;
  if (data[2] != 0x10) return false;
  if (data[6] != 0x02) return false;

  uint8_t counterBlock[16] = {0};
  counterBlock[0] = data[7];
  counterBlock[1] = data[8];

  uint8_t keystream[16] = {0};
  aes.encryptBlock(keystream, counterBlock);

  const int encLen = actualLen - 10;
  if (encLen <= 0 || encLen > 16) return false;

  uint8_t decrypted[16] = {0};
  for (int i = 0; i < encLen; i++) {
    decrypted[i] = data[10 + i] ^ keystream[i];
  }

  bool inf_ttg = false;
  bool na_batV = false;
  bool na_aux = false;
  bool na_batA = false;
  bool na_soc = false;

  result.ttgDays = parseTimeToGoDays(decrypted, inf_ttg);
  result.voltage = parseBatteryVoltage(decrypted, na_batV);
  result.auxVoltage = parseAuxVoltage(decrypted, na_aux);
  result.current = parseBatteryCurrent(decrypted, na_batA);
  result.soc = parseStateOfCharge(decrypted, na_soc);

  if (!isnan(result.voltage) && !isnan(result.current)) {
    result.power = result.voltage * result.current;
  } else {
    result.power = NAN;
  }

  result.valid = !na_batV && !na_batA && !na_soc;
  return result.valid;
}

void pollVictronAdvertisements() {
  BLEDevice device = BLE.available();
  if (!device) return;

  BatteryData decoded;
  if (!decodeVictronDevice(device, decoded)) return;

  latestBatteryData = decoded;
  latestBatteryDataAtMs = millis();

  Serial.println("Updated latest Victron reading from BLE.");
}

// ============================================================
// RECORD HANDLING
// ============================================================

bool buildTelemetryRecordFromLatest(TelemetryRecord& rec) {
  if (!latestBatteryData.valid) return false;
  if ((millis() - latestBatteryDataAtMs) > LATEST_DATA_STALE_MS) return false;

  uint32_t ts = nowUnixSeconds();
  if (ts == 0) return false;

  memset(&rec, 0, sizeof(rec));

  // DS18B20 conversion can block briefly, but it is predictable and only happens on sample ticks.
  tempSensors.requestTemperatures();

  rec.voltage = latestBatteryData.voltage;
  rec.current = latestBatteryData.current;
  rec.soc = latestBatteryData.soc;
  rec.aux_voltage = latestBatteryData.auxVoltage;
  rec.ttg_days = latestBatteryData.ttgDays;
  rec.inside_temp_c = readTempC(insideTempSensor);
  rec.outside_temp_c = readTempC(outsideTempSensor);
  rec.timestamp_s = ts;

  return true;
}

void printRecord(const TelemetryRecord& rec) {
  Serial.println("Queued telemetry:");
  Serial.print("  voltage: "); Serial.println(rec.voltage, 2);
  Serial.print("  current: "); Serial.println(rec.current, 3);
  Serial.print("  soc: "); Serial.println(rec.soc, 1);
  Serial.print("  aux_voltage: "); Serial.println(rec.aux_voltage, 2);
  Serial.print("  ttg_days: "); Serial.println(rec.ttg_days, 2);
  Serial.print("  inside_temp_c: "); Serial.println(rec.inside_temp_c, 2);
  Serial.print("  outside_temp_c: "); Serial.println(rec.outside_temp_c, 2);
  Serial.print("  timestamp_s: "); Serial.println(rec.timestamp_s);
}

void sampleAndQueueTelemetry() {
  if (REQUIRE_TIME_SYNC_BEFORE_LOGGING && !timeSynced) {
    Serial.println("No valid time sync yet; skipping sample.");
    return;
  }

  TelemetryRecord rec;
  if (!buildTelemetryRecordFromLatest(rec)) {
    Serial.println("No fresh Victron data available to sample.");
    return;
  }

  queuePushWithOverwrite(rec);
  printRecord(rec);

  Serial.print("Queue count after sample: ");
  Serial.println(queueHeader.count);
}

// ============================================================
// SERVICES
// ============================================================

void serviceWifiRecovery() {
  if (authFailure) return;

  unsigned long now = millis();

  if (WiFi.status() == WL_CONNECTED &&
      !internetUsable &&
      wifiConnectedSinceMs != 0 &&
      now - wifiConnectedSinceMs >= WIFI_MAX_CONNECTED_WITHOUT_INTERNET_MS) {
    forceWifiReset("Wi-Fi connected too long without confirmed internet");
    return;
  }

  if (queueHeader.count >= MIN_QUEUE_FOR_STALL_RESET &&
      lastSuccessfulUploadMs != 0 &&
      now - lastSuccessfulUploadMs >= UPLOAD_STALL_RESET_MS) {
    forceWifiReset("queue growing and no successful uploads recently");
    return;
  }
}

void serviceTimeSync() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!internetUsable) return;

  if (!timeSynced || millis() - lastTimeSyncAttemptMs >= TIME_SYNC_RETRY_INTERVAL_MS) {
    lastTimeSyncAttemptMs = millis();
    trySyncTime();
  }
}

void serviceSampling() {
  unsigned long now = millis();

  while (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs += SAMPLE_INTERVAL_MS;
    sampleAndQueueTelemetry();

    // Prevent a long catch-up loop after any temporary blocking. Missing one catch-up sample is
    // better than starving BLE/Wi-Fi for many iterations.
    if (millis() - now > 1000) {
      lastSampleMs = millis();
      break;
    }
  }
}

void serviceScheduledUploads() {
  unsigned long now = millis();

  while (now - lastUploadMs >= UPLOAD_INTERVAL_MS) {
    lastUploadMs += UPLOAD_INTERVAL_MS;

    if (!queueIsEmpty() && !authFailure) {
      Serial.print("Upload tick. Queue count: ");
      Serial.println(queueHeader.count);

      if (WiFi.status() != WL_CONNECTED) {
        Serial.println("Upload skipped: Wi-Fi not connected.");
      } else if (!internetUsable) {
        Serial.println("Upload skipped: internet not confirmed.");
      } else {
        flushQueuedRecords();
      }
    }

    // Only ever do one upload attempt per main loop pass.
    break;
  }
}

void serviceBackoffRetryUploads() {
  if (!queueIsEmpty() &&
      !authFailure &&
      WiFi.status() == WL_CONNECTED &&
      internetUsable &&
      nextUploadAttemptMs != 0 &&
      millis() >= nextUploadAttemptMs) {
    Serial.println("Backoff expired; retrying batch upload.");
    flushQueuedRecords();
  }
}

// ============================================================
// SETUP / LOOP
// ============================================================

void setup() {
  Serial.begin(115200);
  while (!Serial) {}

  Serial.println();
  Serial.println("Starting Troopy SmartShunt telemetry uploader...");

  Serial.print("EEPROM available bytes: ");
  Serial.println(EEPROM.length());

  Serial.print("TelemetryRecord size: ");
  Serial.println(sizeof(TelemetryRecord));

  Serial.print("QueueHeader size: ");
  Serial.println(sizeof(QueueHeader));

  Serial.print("Max queue records: ");
  Serial.println(MAX_QUEUE_RECORDS);

  Serial.print("EEPROM bytes needed: ");
  Serial.println(EEPROM_BYTES_NEEDED);

  unsigned long approxRetentionSeconds = (unsigned long)MAX_QUEUE_RECORDS * (SAMPLE_INTERVAL_MS / 1000UL);
  Serial.print("Approx retention minutes: ");
  Serial.println(approxRetentionSeconds / 60.0f, 1);

  if (EEPROM.length() < EEPROM_BYTES_NEEDED) {
    Serial.println("WARNING: EEPROM may be too small for configured queue.");
    Serial.print("Need bytes: ");
    Serial.println(EEPROM_BYTES_NEEDED);
    Serial.print("Available bytes: ");
    Serial.println(EEPROM.length());
  }

  loadOrInitQueue();

  if (!BLE.begin()) {
    Serial.println("BLE failed");
    while (1) {}
  }

  aes.setKey(victronKey, 16);

  Serial.println("Scanning BLE...");
  BLE.scan();

  sslClient.setTimeout(HTTP_TIMEOUT_MS);
  internetProbeClient.setTimeout(HTTP_TIMEOUT_MS);
  httpClient.setTimeout(HTTP_TIMEOUT_MS);

  unsigned long now = millis();
  lastSampleMs = now;
  lastUploadMs = now;
  lastSuccessfulUploadMs = now;

  serviceWifi();
}

void loop() {
  // Highest priority: keep BLE polling happening constantly.
  pollVictronAdvertisements();

  // Non-blocking / bounded services. Uploads only run when internet has been confirmed.
  serviceWifi();
  serviceInternetGate();
  serviceWifiRecovery();
  serviceTimeSync();
  serviceSampling();
  serviceScheduledUploads();
  serviceBackoffRetryUploads();

  delay(5);
}
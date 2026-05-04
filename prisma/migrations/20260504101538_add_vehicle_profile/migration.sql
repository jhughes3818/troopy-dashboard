-- CreateTable
CREATE TABLE "VehicleProfile" (
    "id" TEXT NOT NULL DEFAULT 'vehicle',
    "tankCapacityL" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "VehicleProfile_pkey" PRIMARY KEY ("id")
);

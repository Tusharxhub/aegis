-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfrastructureEvent" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "rawLogs" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfrastructureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemediationPlan" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "aiAnalysis" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "suggestedAction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemediationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionExecution" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "isSuccessful" BOOLEAN NOT NULL,
    "executionLogs" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Service_containerId_key" ON "Service"("containerId");

-- CreateIndex
CREATE UNIQUE INDEX "RemediationPlan_eventId_key" ON "RemediationPlan"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionExecution_planId_key" ON "ActionExecution"("planId");

-- AddForeignKey
ALTER TABLE "InfrastructureEvent" ADD CONSTRAINT "InfrastructureEvent_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationPlan" ADD CONSTRAINT "RemediationPlan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InfrastructureEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionExecution" ADD CONSTRAINT "ActionExecution_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RemediationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionExecution" ADD CONSTRAINT "ActionExecution_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { FuelLog, FuelLogDocument } from './schemas/fuel-log.schema.js';
import { MaintenanceLog, MaintenanceLogDocument } from './schemas/maintenance-log.schema.js';
import { IncidentalLog, IncidentalLogDocument } from './schemas/incidental-log.schema.js';
import { InwardVoucher, InwardVoucherDocument } from './schemas/inward-voucher.schema.js';
import { YardReconciliation, YardReconciliationDocument } from './schemas/yard-reconciliation.schema.js';
import { CashFloat, CashFloatDocument } from './schemas/cash-float.schema.js';
import { YardStock, YardStockDocument } from './schemas/yard-stock.schema.js';
import { OutwardDispatch, OutwardDispatchDocument } from './schemas/outward-dispatch.schema.js';
import { EmployeeProfile, EmployeeProfileDocument, EmployeeStatus } from '../employees/schemas/employee-profile.schema.js';

@Injectable()
export class OperationsService implements OnModuleInit {
  private readonly logger = new Logger(OperationsService.name);

  constructor(
    @InjectModel(FuelLog.name)
    private readonly fuelLogModel: Model<FuelLogDocument>,
    @InjectModel(MaintenanceLog.name)
    private readonly maintenanceLogModel: Model<MaintenanceLogDocument>,
    @InjectModel(IncidentalLog.name)
    private readonly incidentalLogModel: Model<IncidentalLogDocument>,
    @InjectModel(InwardVoucher.name)
    private readonly inwardVoucherModel: Model<InwardVoucherDocument>,
    @InjectModel(YardReconciliation.name)
    private readonly yardReconciliationModel: Model<YardReconciliationDocument>,
    @InjectModel(CashFloat.name)
    private readonly cashFloatModel: Model<CashFloatDocument>,
    @InjectModel(YardStock.name)
    private readonly yardStockModel: Model<YardStockDocument>,
    @InjectModel(OutwardDispatch.name)
    private readonly outwardDispatchModel: Model<OutwardDispatchDocument>,
    @InjectModel(EmployeeProfile.name)
    private readonly employeeProfileModel: Model<EmployeeProfileDocument>,
  ) {}

  async onModuleInit() {
    await this.seedInitialOperationsData();
  }

  private async seedInitialOperationsData() {
    // 1. Seed Fuel Logs if empty
    const fuelCount = await this.fuelLogModel.countDocuments();
    if (fuelCount === 0) {
      this.logger.log('Seeding initial Fuel Logs into MongoDB...');
      await this.fuelLogModel.insertMany([
        {
          vehicleReg: 'AP 16 TF 2234',
          driverName: 'K. Venkatesh',
          fuelType: 'DIESEL',
          quantity: 18.0,
          ratePerUnit: 98.5,
          totalCostRupees: 1773.0,
          odometerReading: 51200,
          kmSinceLastRefuel: 210,
          calculatedMileage: '11.6 km/L',
          stationName: 'HP Fuel Station - Benz Circle',
          incurredAt: 'Today, 07:45 AM',
        },
        {
          vehicleReg: 'AP 16 TX 4021',
          driverName: 'Ramesh Kumar',
          fuelType: 'ELECTRICITY',
          quantity: 14.5,
          ratePerUnit: 9.0,
          totalCostRupees: 130.5,
          odometerReading: 15480,
          kmSinceLastRefuel: 85,
          calculatedMileage: '5.8 km/kWh',
          stationName: 'Vijayawada Central Yard EV Charger #2',
          incurredAt: 'Today, 06:30 AM',
        },
      ]);
    }

    // 2. Seed Maintenance Logs if empty
    const maintCount = await this.maintenanceLogModel.countDocuments();
    if (maintCount === 0) {
      this.logger.log('Seeding initial Maintenance Logs into MongoDB...');
      await this.maintenanceLogModel.insertMany([
        {
          vehicleReg: 'AP 16 TF 2234',
          maintenanceType: 'ROUTINE_SERVICE',
          garageName: 'Sri Balaji Commercial Garage, Autonagar',
          odometer: 48000,
          costRupees: 4200,
          description: 'Engine oil flush, diesel filter replacement, clutch play adjustment',
          downtimeHours: 6,
          serviceDate: '2026-09-18',
          invoiceNumber: 'INV-GAR-8492',
        },
        {
          vehicleReg: 'AP 16 TX 4021',
          maintenanceType: 'ROUTINE_SERVICE',
          garageName: 'Piaggio Commercial Authorized Service',
          odometer: 14200,
          costRupees: 2400,
          description: 'Brake shoe adjustment, EV battery diagnostic check, wiring inspection',
          downtimeHours: 4,
          serviceDate: '2026-09-24',
          invoiceNumber: 'PAG-SER-1092',
        },
      ]);
    }

    // 3. Seed Incidentals if empty
    const incCount = await this.incidentalLogModel.countDocuments();
    if (incCount === 0) {
      this.logger.log('Seeding initial Incidental Logs into MongoDB...');
      await this.incidentalLogModel.insertMany([
        {
          vehicleReg: 'AP 16 TF 2234',
          driverName: 'K. Venkatesh',
          expenseType: 'TOLL_PLAZA',
          amountRupees: 110,
          notes: 'Kaza Toll Plaza on Guntur Highway bulk scrap pickup',
          incurredAt: 'Today, 11:20 AM',
        },
        {
          vehicleReg: 'AP 16 TE 9081',
          driverName: 'Siva Krishna',
          expenseType: 'PUNCTURE_REPAIR',
          amountRupees: 80,
          notes: 'Rear left tube puncture vulcanizing at Madhura Nagar',
          incurredAt: 'Yesterday, 02:40 PM',
        },
      ]);
    }

    // 4. Seed Inward Vouchers if empty
    const inwardCount = await this.inwardVoucherModel.countDocuments();
    if (inwardCount === 0) {
      this.logger.log('Seeding initial Inward Vouchers into MongoDB...');
      await this.inwardVoucherModel.insertMany([
        {
          voucherNumber: 'YRD-20261012-084',
          channel: 'YARD_WALK_IN',
          divisionId: 'div_vja_central',
          divisionName: 'Vijayawada Central Yard (Gate 1)',
          sellerName: 'Subba Rao (Local Kabadi)',
          sellerPhone: '9848012345',
          sellerType: 'LOCAL_KABADIS',
          vehicleReg: 'Walk-in Handcart',
          items: [
            {
              productId: 'p_iron',
              categoryName: 'Metal',
              productName: 'Heavy Scrap Iron / Loha',
              ratePerKgRupees: 28.0,
              grossWeightKg: 120.0,
              deductionKg: 2.0,
              deductionReason: 'Mud & Rust Dust Contamination',
              netWeightKg: 118.0,
              lineTotalRupees: 3304.0,
            },
            {
              productId: 'p_cardboard',
              categoryName: 'Paper',
              productName: 'Cardboard / Carton (Old Cartons)',
              ratePerKgRupees: 9.0,
              grossWeightKg: 45.0,
              deductionKg: 0,
              deductionReason: 'None',
              netWeightKg: 45.0,
              lineTotalRupees: 405.0,
            },
          ],
          totalGrossKg: 165.0,
          totalDeductionKg: 2.0,
          totalNetKg: 163.0,
          grandTotalRupees: 3709.0,
          paymentMethod: 'CASH',
          paymentStatus: 'PAID',
          operatorName: 'Suresh Babu (Yard Scale Operator)',
          status: 'RECEIVED_VERIFIED',
          timestamp: 'Today, 11:42 AM',
        },
        {
          voucherNumber: 'B2B-20261012-005',
          channel: 'B2B_COMMERCIAL',
          divisionId: 'div_vja_central',
          divisionName: 'Vijayawada Central Yard (Heavy Weighbridge)',
          sellerName: 'Sri Srinivasa Packaging Industries',
          sellerPhone: '9440123987',
          sellerType: 'CORPORATE_B2B',
          vehicleReg: 'AP 16 TF 4490',
          assignedCollectorName: 'Weighbridge Senior Officer',
          truckGrossWeightKg: 4850,
          truckTareWeightKg: 2420,
          gstin: '37AABCS1429B1Z2',
          eWayBillNumber: '2418-4902-8812',
          items: [
            {
              productId: 'p_cardboard_b2b',
              categoryName: 'Paper',
              productName: 'Industrial Kraft & Corrugated Trimmings',
              ratePerKgRupees: 10.5,
              grossWeightKg: 2430.0,
              deductionKg: 30.0,
              deductionReason: 'High Moisture Content (>14% moisture meter reading)',
              netWeightKg: 2400.0,
              lineTotalRupees: 25200.0,
            },
          ],
          totalGrossKg: 2430.0,
          totalDeductionKg: 30.0,
          totalNetKg: 2400.0,
          grandTotalRupees: 25200.0,
          paymentMethod: 'NEFT_RTGS',
          paymentStatus: 'PAID',
          operatorName: 'K. Venkat Rao (Yard Manager)',
          status: 'RECEIVED_VERIFIED',
          timestamp: 'Today, 10:15 AM',
        },
      ]);
    }

    // 5. Seed Yard Reconciliations if empty
    const recCount = await this.yardReconciliationModel.countDocuments();
    if (recCount === 0) {
      this.logger.log('Seeding initial Yard Reconciliations into MongoDB...');
      await this.yardReconciliationModel.insertMany([
        {
          date: '2026-10-12',
          vehicleReg: 'AP 16 TX 4021',
          collectorCode: 'AKP-EMP-0247',
          collectorName: 'Ramesh Kumar',
          routeDivision: 'Vijayawada Central',
          expectedFieldPickupsCount: 6,
          reportedFieldTotalKg: 486.5,
          physicalYardScaleKg: 485.0,
          weightVarianceKg: -1.5,
          variancePercentage: -0.31,
          status: 'PERFECT_MATCH',
          verifiedAt: '12:30 PM',
          supervisorName: 'K. Venkat Rao',
          auditNotes: 'Variance within acceptable threshold (<0.5%). Unloaded into Bay A2.',
        },
      ]);
    }

    // 6. Seed Cash Floats if empty
    const floatCount = await this.cashFloatModel.countDocuments();
    if (floatCount === 0) {
      this.logger.log('Seeding initial Cash Floats into MongoDB...');
      await this.cashFloatModel.insertMany([
        {
          date: '2026-10-12',
          employeeCode: 'AKP-EMP-0247',
          employeeName: 'Ramesh Kumar',
          vehicleReg: 'AP 16 TX 4021',
          openingFloatRupees: 15000,
          issuedTime: '08:00 AM',
          issuedByAdmin: 'Admin Operations',
          verifiedCustomerCashPayoutsRupees: 11450,
          approvedRouteExpensesRupees: 130.5,
          expectedCashReturnRupees: 3419.5,
          actualPhysicalCashReturnedRupees: null,
          varianceRupees: 0,
          status: 'ISSUED',
        },
        {
          date: '2026-10-12',
          employeeCode: 'AKP-EMP-0182',
          employeeName: 'Siva Krishna',
          vehicleReg: 'AP 16 TE 9081',
          openingFloatRupees: 12000,
          issuedTime: '08:10 AM',
          issuedByAdmin: 'Admin Operations',
          verifiedCustomerCashPayoutsRupees: 8900,
          approvedRouteExpensesRupees: 80,
          expectedCashReturnRupees: 3020,
          actualPhysicalCashReturnedRupees: null,
          varianceRupees: 0,
          status: 'ISSUED',
        },
        {
          date: '2026-10-11',
          employeeCode: 'AKP-EMP-0247',
          employeeName: 'Ramesh Kumar',
          vehicleReg: 'AP 16 TX 4021',
          openingFloatRupees: 15000,
          issuedTime: '08:00 AM',
          issuedByAdmin: 'Admin Operations',
          verifiedCustomerCashPayoutsRupees: 12800,
          approvedRouteExpensesRupees: 0,
          expectedCashReturnRupees: 2200,
          actualPhysicalCashReturnedRupees: 2200,
          varianceRupees: 0,
          reconciledTime: '06:15 PM',
          reconciledByAdmin: 'K. Venkat Rao (Yard Mgr)',
          status: 'BALANCED',
          auditNotes: 'Perfect count matching scale vouchers.',
        },
      ]);
    }

    // 7. Seed Yard Stock if empty
    const stockCount = await this.yardStockModel.countDocuments();
    if (stockCount === 0) {
      this.logger.log('Seeding initial Yard Stock into MongoDB...');
      await this.yardStockModel.insertMany([
        {
          categoryName: 'Metal',
          productName: 'Heavy Scrap Iron / Loha',
          stage: 'BALED_READY_FOR_SALE',
          yardLocation: 'Vijayawada Central - Bay A1',
          currentTonnageKg: 14200,
          averageInwardCostPerKgRupees: 28.0,
          marketWholesaleRatePerKgRupees: 32.5,
          unrealizedGrossMarginRupees: 63900,
        },
        {
          categoryName: 'Paper',
          productName: 'Corrugated Cardboard (Baled)',
          stage: 'BALED_READY_FOR_SALE',
          yardLocation: 'Vijayawada Central - Bay B2',
          currentTonnageKg: 28500,
          averageInwardCostPerKgRupees: 13.5,
          marketWholesaleRatePerKgRupees: 17.2,
          unrealizedGrossMarginRupees: 105450,
        },
        {
          categoryName: 'Metal',
          productName: 'Copper / Tamba Cut-Pieces',
          stage: 'BALED_READY_FOR_SALE',
          yardLocation: 'Vijayawada Central - Secure Vault #1',
          currentTonnageKg: 1850,
          averageInwardCostPerKgRupees: 605.0,
          marketWholesaleRatePerKgRupees: 650.0,
          unrealizedGrossMarginRupees: 83250,
        },
        {
          categoryName: 'Plastic',
          productName: 'PET Bottles (Baled Transparent)',
          stage: 'BALED_READY_FOR_SALE',
          yardLocation: 'Vijayawada Central - Bay C1',
          currentTonnageKg: 8900,
          averageInwardCostPerKgRupees: 15.0,
          marketWholesaleRatePerKgRupees: 19.5,
          unrealizedGrossMarginRupees: 40050,
        },
        {
          categoryName: 'Metal',
          productName: 'Mixed Unsorted Scrap Metal',
          stage: 'RAW_UNSORTED',
          yardLocation: 'Vijayawada Central - Unloading Floor',
          currentTonnageKg: 6400,
          averageInwardCostPerKgRupees: 24.0,
          marketWholesaleRatePerKgRupees: 29.0,
          unrealizedGrossMarginRupees: 32000,
        },
      ]);
    }

    // 8. Seed Outward Dispatches if empty
    const dispatchCount = await this.outwardDispatchModel.countDocuments();
    if (dispatchCount === 0) {
      this.logger.log('Seeding initial Outward Dispatches into MongoDB...');
      await this.outwardDispatchModel.insertMany([
        {
          gatePassNumber: 'GP-20261012-014',
          destinationMillName: 'Vizag Mandi Smelters & Rolling Mills',
          destinationCity: 'Visakhapatnam, AP',
          categoryName: 'Metal',
          productName: 'Heavy Scrap Iron / Loha (Baled)',
          dispatchedWeightKg: 12500,
          agreedMillRatePerKgRupees: 32.5,
          inwardCostPerKgRupees: 28.0,
          grossRealizedMarginRupees: 56250,
          totalInvoiceValueRupees: 406250,
          vehicleReg: 'AP 16 TE 9812',
          driverName: 'Ch. Satyanarayana',
          driverPhone: '9440118833',
          eWayBillNumber: '2419-8802-9912',
          paymentStatus: 'PAID_FULL',
          dispatchTimestamp: 'Today, 09:30 AM',
          authorizedBy: 'Ramesh Varma (Yard In-charge)',
        },
        {
          gatePassNumber: 'GP-20261011-008',
          destinationMillName: 'ITC Paperboards and Specialty Papers Div',
          destinationCity: 'Bhadrachalam',
          categoryName: 'Paper',
          productName: 'Corrugated Cardboard (Dense Hydraulic Bales)',
          dispatchedWeightKg: 18200,
          agreedMillRatePerKgRupees: 17.0,
          inwardCostPerKgRupees: 13.5,
          grossRealizedMarginRupees: 63700,
          totalInvoiceValueRupees: 309400,
          vehicleReg: 'AP 07 TJ 4455',
          driverName: 'Sk. Rahmatullah',
          driverPhone: '9849221144',
          eWayBillNumber: '2419-7718-4421',
          paymentStatus: 'PENDING_REMITTANCE',
          dispatchTimestamp: 'Yesterday, 04:15 PM',
          authorizedBy: 'K. Venkat Rao (Yard Mgr)',
        },
      ]);
    }
  }

  // --- Fuel Logs ---
  async getFuelLogs(): Promise<FuelLogDocument[]> {
    return this.fuelLogModel.find().sort({ createdAt: -1 });
  }

  async createFuelLog(data: Partial<FuelLog>): Promise<FuelLogDocument> {
    return this.fuelLogModel.create(data);
  }

  // --- Maintenance Logs ---
  async getMaintenanceLogs(): Promise<MaintenanceLogDocument[]> {
    return this.maintenanceLogModel.find().sort({ createdAt: -1 });
  }

  async createMaintenanceLog(data: Partial<MaintenanceLog>): Promise<MaintenanceLogDocument> {
    return this.maintenanceLogModel.create(data);
  }

  // --- Incidental Logs ---
  async getIncidentalLogs(): Promise<IncidentalLogDocument[]> {
    return this.incidentalLogModel.find().sort({ createdAt: -1 });
  }

  async createIncidentalLog(data: Partial<IncidentalLog>): Promise<IncidentalLogDocument> {
    return this.incidentalLogModel.create(data);
  }

  // --- Inward Vouchers ---
  async getInwardVouchers(channel?: string): Promise<InwardVoucherDocument[]> {
    const filter = channel && channel !== 'ALL' ? { channel } : {};
    return this.inwardVoucherModel.find(filter).sort({ createdAt: -1 });
  }

  async createInwardVoucher(data: Partial<InwardVoucher>): Promise<InwardVoucherDocument> {
    if (!data.voucherNumber) {
      const suffix = Math.floor(1000 + Math.random() * 9000);
      data.voucherNumber = `YRD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${suffix}`;
    }
    return this.inwardVoucherModel.create(data);
  }

  // --- Yard Reconciliations ---
  async getYardReconciliations(): Promise<YardReconciliationDocument[]> {
    return this.yardReconciliationModel.find().sort({ createdAt: -1 });
  }

  async signOffReconciliation(id: string, notes?: string): Promise<YardReconciliationDocument> {
    const rec = await this.yardReconciliationModel.findById(id);
    if (!rec) throw new NotFoundException('Reconciliation record not found');
    rec.status = 'PERFECT_MATCH';
    rec.auditNotes = notes || 'Signed off and verified by supervisor';
    return rec.save();
  }

  // --- Cash Floats ---
  async getCashFloats(date?: string): Promise<CashFloatDocument[]> {
    const filter = date ? { date } : {};
    return this.cashFloatModel.find(filter).sort({ createdAt: -1 });
  }

  async issueCashFloat(data: {
    employeeCode: string;
    employeeName: string;
    vehicleReg?: string;
    openingFloatRupees: number;
    issuedByAdmin?: string;
  }): Promise<CashFloatDocument> {
    return this.cashFloatModel.create({
      ...data,
      date: new Date().toISOString().split('T')[0],
      expectedCashReturnRupees: data.openingFloatRupees,
      status: 'ISSUED',
    });
  }

  async settleCashFloat(
    id: string,
    data: { actualPhysicalCashReturnedRupees: number; auditNotes?: string },
  ): Promise<CashFloatDocument> {
    const flt = await this.cashFloatModel.findById(id);
    if (!flt) throw new NotFoundException('Cash float record not found');

    flt.actualPhysicalCashReturnedRupees = data.actualPhysicalCashReturnedRupees;
    flt.varianceRupees = data.actualPhysicalCashReturnedRupees - flt.expectedCashReturnRupees;
    flt.reconciledTime = new Date().toLocaleTimeString();
    flt.auditNotes = data.auditNotes || '';

    if (Math.abs(flt.varianceRupees) <= 5) {
      flt.status = 'BALANCED';
    } else if (flt.varianceRupees < -5) {
      flt.status = 'SHORTAGE_FLAGGED';
    } else {
      flt.status = 'SURPLUS_FLAGGED';
    }

    return flt.save();
  }

  // --- Yard Stock ---
  async getYardStock(): Promise<YardStockDocument[]> {
    return this.yardStockModel.find().sort({ currentTonnageKg: -1 });
  }

  async createOrUpdateYardStock(data: Partial<YardStock>): Promise<YardStockDocument> {
    return this.yardStockModel.create(data);
  }

  // --- Outward Dispatches ---
  async getOutwardDispatches(): Promise<OutwardDispatchDocument[]> {
    return this.outwardDispatchModel.find().sort({ createdAt: -1 });
  }

  async createOutwardDispatch(data: Partial<OutwardDispatch>): Promise<OutwardDispatchDocument> {
    if (!data.gatePassNumber) {
      const suffix = Math.floor(100 + Math.random() * 900);
      data.gatePassNumber = `GP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${suffix}`;
    }
    return this.outwardDispatchModel.create(data);
  }

  // --- Workforce Employees & KYC ---
  async getEmployees(): Promise<any[]> {
    const profiles = await this.employeeProfileModel.find().populate('userId');
    if (profiles.length > 0) {
      return profiles.map((p: any) => ({
        id: p._id.toString(),
        employeeCode: `AKP-EMP-${p._id.toString().slice(-4).toUpperCase()}`,
        name: p.userId?.name || 'Field Officer',
        phone: p.userId?.mobileNumber || '9876543210',
        role: 'FIELD_COLLECTOR',
        assignedDivision: 'Vijayawada Central',
        kyc: {
          status: p.status === EmployeeStatus.APPROVED ? 'APPROVED' : 'PENDING_REVIEW',
          aadhaarMasked: 'XXXX-XXXX-4921',
          policeVerificationDone: p.status === EmployeeStatus.APPROVED,
          joinedDate: p.createdAt?.toISOString().split('T')[0] || '2026-08-01',
        },
        compensation: {
          payModel: 'MONTHLY_SALARY',
          basePayRupees: 18000,
          incentivePerKgPaise: 50,
          bankAccountMasked: 'HDFC •••• 9102',
          upiId: 'collector@apl',
        },
        todayAttendance: p.status === EmployeeStatus.APPROVED ? 'PRESENT_ON_ROUTE' : 'PRESENT_IN_YARD',
        checkInTime: '08:00 AM',
        metrics: {
          rating: 4.9,
          totalPickupsCompleted: 142,
          totalKgCollected: 4850,
          todayKgCollected: 240,
          todayPickupsCompleted: 4,
        },
      }));
    }

    // Default seeded staff
    return [
      {
        id: 'emp_01',
        employeeCode: 'AKP-EMP-0247',
        name: 'Ramesh Kumar',
        phone: '9876543210',
        role: 'FIELD_COLLECTOR',
        assignedDivision: 'Vijayawada Central',
        assignedVehicleReg: 'AP 16 TX 4021',
        kyc: {
          status: 'APPROVED',
          aadhaarMasked: 'XXXX-XXXX-4921',
          policeVerificationDone: true,
          joinedDate: '2026-05-10',
        },
        compensation: {
          payModel: 'MONTHLY_SALARY',
          basePayRupees: 18000,
          incentivePerKgPaise: 50,
          bankAccountMasked: 'SBI •••• 1042',
          upiId: 'ramesh.scrap@okaxis',
        },
        todayAttendance: 'PRESENT_ON_ROUTE',
        checkInTime: '07:45 AM',
        metrics: {
          rating: 4.9,
          totalPickupsCompleted: 312,
          totalKgCollected: 12450,
          todayKgCollected: 640,
          todayPickupsCompleted: 3,
        },
      },
      {
        id: 'emp_02',
        employeeCode: 'AKP-EMP-0182',
        name: 'Siva Krishna',
        phone: '9440112233',
        role: 'FIELD_COLLECTOR',
        assignedDivision: 'Vijayawada East',
        assignedVehicleReg: 'AP 16 TE 9081',
        kyc: {
          status: 'APPROVED',
          aadhaarMasked: 'XXXX-XXXX-8821',
          policeVerificationDone: true,
          joinedDate: '2026-06-01',
        },
        compensation: {
          payModel: 'MONTHLY_SALARY',
          basePayRupees: 18000,
          incentivePerKgPaise: 50,
          bankAccountMasked: 'ICICI •••• 9920',
          upiId: 'siva.krishna@ybl',
        },
        todayAttendance: 'PRESENT_ON_ROUTE',
        checkInTime: '07:55 AM',
        metrics: {
          rating: 4.8,
          totalPickupsCompleted: 240,
          totalKgCollected: 9800,
          todayKgCollected: 490,
          todayPickupsCompleted: 2,
        },
      },
      {
        id: 'emp_03',
        employeeCode: 'AKP-EMP-0310',
        name: 'K. Venkatesh',
        phone: '9988776655',
        role: 'DRIVER',
        assignedDivision: 'Vijayawada Central',
        assignedVehicleReg: 'AP 16 TF 2234',
        kyc: {
          status: 'APPROVED',
          aadhaarMasked: 'XXXX-XXXX-3341',
          dlNumber: 'AP162018004921',
          dlValidUntil: '2029-08-15',
          policeVerificationDone: true,
          joinedDate: '2026-07-15',
        },
        compensation: {
          payModel: 'DAILY_WAGE',
          basePayRupees: 750,
          incentivePerKgPaise: 20,
          bankAccountMasked: 'Andhra Bank •••• 4401',
          upiId: 'venky.drive@paytm',
        },
        todayAttendance: 'PRESENT_ON_ROUTE',
        checkInTime: '08:05 AM',
        metrics: {
          rating: 4.7,
          totalPickupsCompleted: 180,
          totalKgCollected: 18400,
          todayKgCollected: 1250,
          todayPickupsCompleted: 4,
        },
      },
      {
        id: 'emp_04',
        employeeCode: 'AKP-EMP-0399',
        name: 'P. Naga Raju',
        phone: '9700445566',
        role: 'YARD_SORTER',
        assignedDivision: 'Vijayawada Central',
        kyc: {
          status: 'APPROVED',
          aadhaarMasked: 'XXXX-XXXX-1109',
          policeVerificationDone: true,
          joinedDate: '2026-08-01',
        },
        compensation: {
          payModel: 'MONTHLY_SALARY',
          basePayRupees: 16000,
          incentivePerKgPaise: 0,
          bankAccountMasked: 'HDFC •••• 7712',
          upiId: 'nagaraju@okhdfcbank',
        },
        todayAttendance: 'PRESENT_IN_YARD',
        checkInTime: '08:00 AM',
        metrics: {
          rating: 5.0,
          totalPickupsCompleted: 0,
          totalKgCollected: 24500,
          todayKgCollected: 850,
          todayPickupsCompleted: 0,
        },
      },
    ];
  }

  async updateKycStatus(id: string, status: string): Promise<any> {
    const profile = await this.employeeProfileModel.findById(id);
    if (profile) {
      profile.status = status === 'APPROVED' ? EmployeeStatus.APPROVED : EmployeeStatus.PENDING_REVIEW;
      await profile.save();
      return { success: true, status };
    }
    return { success: true, status: 'APPROVED' };
  }

  // In-memory / dynamic store for fraud sentinel alerts
  private fraudAlerts = [
    {
      id: 'alt_01',
      category: 'WEIGHT_MISMATCH_DUMP',
      severity: 'CRITICAL',
      title: 'Dump Scale Weight Shortage > 3.2%',
      description: 'Vehicle AP 16 TF 2234 reported 780.0 kg on mobile app, but physical yard platform scale weighed 755.0 kg (-25.0 kg shortage).',
      subjectCode: 'AKP-EMP-0310',
      subjectName: 'K. Venkatesh (Driver) & Md. Ismail (Collector)',
      detectedAt: 'Today, 11:32 AM',
      financialRiskRupees: 700,
      status: 'OPEN_PENDING_ACTION',
    },
    {
      id: 'alt_02',
      category: 'FLOAT_CASH_SHORTAGE',
      severity: 'WARNING',
      title: 'Evening Cash Float Unexplained Discrepancy',
      description: 'Cash float flt_092 closed with ₹450 unexplained shortage after deducting verified OTP pickups and approved EV charging vouchers.',
      subjectCode: 'AKP-EMP-0182',
      subjectName: 'Siva Krishna (Field Picker)',
      detectedAt: '11 Oct 2026, 18:45',
      financialRiskRupees: 450,
      status: 'ACKNOWLEDGED_INVESTIGATING',
    },
    {
      id: 'alt_03',
      category: 'HIGH_WASTAGE_DEDUCTION',
      severity: 'WARNING',
      title: 'Abnormal Deduction Frequency (6.8% vs Yard Avg 2.1%)',
      description: 'Collector recorded 6.8% average moisture deduction across 12 consecutive pickups in Moghalrajpuram. Exceeds historical weather threshold.',
      subjectCode: 'AKP-EMP-0247',
      subjectName: 'Ramesh Kumar (Field Collector)',
      detectedAt: 'Today, 12:15 PM',
      financialRiskRupees: 380,
      status: 'OPEN_PENDING_ACTION',
    },
    {
      id: 'alt_04',
      category: 'DUPLICATE_CUSTOMER_PHONE',
      severity: 'INFO',
      title: 'Multiple Pickup Requests from Same Number in Different Divisions',
      description: 'Phone 9848112233 scheduled 3 simultaneous pickups across Vijayawada East and Guntur on the same day.',
      subjectCode: 'CUST-9848112233',
      subjectName: 'Aggregator Trader (Unverified)',
      detectedAt: 'Today, 09:10 AM',
      status: 'RESOLVED_CLEARED',
      notes: 'Verified commercial bulk cleanout aggregator operating across two yards.',
    },
  ];

  async getFraudAlerts(): Promise<any[]> {
    return this.fraudAlerts;
  }

  async updateFraudAlertStatus(id: string, status: string, notes?: string): Promise<any> {
    const alert = this.fraudAlerts.find((a) => a.id === id);
    if (alert) {
      alert.status = status;
      if (notes) alert.notes = notes;
      return { success: true, alert };
    }
    return { success: false, error: 'Alert not found' };
  }

  async getUnitEconomicsAndPnL(timeWindow = 'THIS_MONTH'): Promise<any> {
    // 1. Calculate inward volumes and payouts from InwardVouchers
    const vouchers = await this.inwardVoucherModel.find();
    let totalInwardPaid = vouchers.reduce((acc, v) => acc + (v.grandTotalRupees || 0), 0);
    if (totalInwardPaid === 0) totalInwardPaid = 3432550;

    // 2. Calculate outward revenue from OutwardDispatches
    const dispatches = await this.outwardDispatchModel.find();
    let totalOutwardRevenue = dispatches.reduce((acc, d) => acc + (d.totalInvoiceValueRupees || 0), 0);
    if (totalOutwardRevenue === 0) totalOutwardRevenue = 4716800;

    // 3. Calculate fleet fuel expenses from FuelLogs
    const fuelLogs = await this.fuelLogModel.find();
    let fuelAndPower = fuelLogs.reduce((acc, f) => acc + (f.totalCostRupees || 0), 0);
    if (fuelAndPower === 0) fuelAndPower = 34850;

    // 4. Calculate fleet maintenance from MaintenanceLogs
    const maintLogs = await this.maintenanceLogModel.find();
    let maintCost = maintLogs.reduce((acc, m) => acc + (m.costRupees || 0), 0);
    if (maintCost === 0) maintCost = 16400;

    const vehicleFleetRents = 62000;
    const crewLaborAndIncentives = 112000;
    const totalOperatingExpenses = vehicleFleetRents + fuelAndPower + crewLaborAndIncentives + maintCost;
    const totalGrossTradingSpread = totalOutwardRevenue - totalInwardPaid;
    const netOperatingProfit = totalGrossTradingSpread - totalOperatingExpenses;
    const netEbitdaMarginPct = ((netOperatingProfit / totalOutwardRevenue) * 100).toFixed(1);

    const categoryBreakdown = [
      {
        categoryName: 'Copper & High-Value Metals',
        inwardKg: 1850,
        totalInwardPaidRupees: 1119250,
        avgBuyingRateRupees: 605.0,
        outwardSoldKg: 2500,
        totalOutwardRevenueRupees: 1625000,
        avgSellingRateRupees: 650.0,
        grossSpreadPerKgRupees: 45.0,
        totalGrossProfitRupees: 112500,
        marginPercent: 7.4,
      },
      {
        categoryName: 'Heavy Scrap Iron & Steel',
        inwardKg: 38400,
        totalInwardPaidRupees: 1075200,
        avgBuyingRateRupees: 28.0,
        outwardSoldKg: 42000,
        totalOutwardRevenueRupees: 1365000,
        avgSellingRateRupees: 32.5,
        grossSpreadPerKgRupees: 4.5,
        totalGrossProfitRupees: 189000,
        marginPercent: 16.1,
      },
      {
        categoryName: 'Corrugated Cardboard & Paper',
        inwardKg: 46200,
        totalInwardPaidRupees: 623700,
        avgBuyingRateRupees: 13.5,
        outwardSoldKg: 54000,
        totalOutwardRevenueRupees: 928800,
        avgSellingRateRupees: 17.2,
        grossSpreadPerKgRupees: 3.7,
        totalGrossProfitRupees: 199800,
        marginPercent: 27.4,
      },
      {
        categoryName: 'Plastics & HDPE Flakes',
        inwardKg: 12400,
        totalInwardPaidRupees: 297600,
        avgBuyingRateRupees: 24.0,
        outwardSoldKg: 14000,
        totalOutwardRevenueRupees: 406000,
        avgSellingRateRupees: 29.0,
        grossSpreadPerKgRupees: 5.0,
        totalGrossProfitRupees: 70000,
        marginPercent: 20.8,
      },
      {
        categoryName: 'Batteries & E-Waste',
        inwardKg: 3600,
        totalInwardPaidRupees: 316800,
        avgBuyingRateRupees: 88.0,
        outwardSoldKg: 4000,
        totalOutwardRevenueRupees: 392000,
        avgSellingRateRupees: 98.0,
        grossSpreadPerKgRupees: 10.0,
        totalGrossProfitRupees: 40000,
        marginPercent: 11.4,
      },
    ];

    return {
      financials: {
        totalOutwardRevenue: `₹${totalOutwardRevenue.toLocaleString('en-IN')}`,
        totalMaterialBuyingCost: `₹${totalInwardPaid.toLocaleString('en-IN')}`,
        totalGrossTradingSpread: `₹${totalGrossTradingSpread.toLocaleString('en-IN')}`,
        totalOperatingExpenses: `₹${totalOperatingExpenses.toLocaleString('en-IN')}`,
        netOperatingProfit: `₹${netOperatingProfit.toLocaleString('en-IN')}`,
        netEbitdaMarginPct: `${netEbitdaMarginPct}%`,
        vehicleFleetRents: `₹${vehicleFleetRents.toLocaleString('en-IN')}`,
        fuelAndPowerCharging: `₹${fuelAndPower.toLocaleString('en-IN')}`,
        crewLaborAndIncentives: `₹${crewLaborAndIncentives.toLocaleString('en-IN')}`,
        routeIncidentalsAndMaintenance: `₹${maintCost.toLocaleString('en-IN')}`,
      },
      categoryBreakdown,
      timeWindow,
    };
  }
}

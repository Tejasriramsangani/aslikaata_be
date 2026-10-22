import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FuelLogDocument = HydratedDocument<FuelLog>;

@Schema({ collection: 'operations_fuel_logs', timestamps: true })
export class FuelLog {
  @Prop({ required: true, uppercase: true, trim: true, index: true })
  vehicleReg: string;

  @Prop({ required: true, trim: true })
  driverName: string;

  @Prop({ required: true, enum: ['DIESEL', 'CNG', 'ELECTRICITY'], default: 'DIESEL' })
  fuelType: string;

  @Prop({ required: true, min: 0 })
  quantity: number; // Liters or kWh

  @Prop({ required: true, min: 0 })
  ratePerUnit: number; // Rs per L or kWh

  @Prop({ required: true, min: 0 })
  totalCostRupees: number;

  @Prop({ required: true, min: 0 })
  odometerReading: number;

  @Prop({ default: 0 })
  kmSinceLastRefuel: number;

  @Prop({ default: '12.0 km/L' })
  calculatedMileage: string;

  @Prop({ default: 'Local Station' })
  stationName: string;

  @Prop({ default: () => new Date().toISOString() })
  incurredAt: string;
}

export const FuelLogSchema = SchemaFactory.createForClass(FuelLog);
FuelLogSchema.index({ vehicleReg: 1, createdAt: -1 });

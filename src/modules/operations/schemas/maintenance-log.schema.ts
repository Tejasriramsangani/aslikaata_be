import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MaintenanceLogDocument = HydratedDocument<MaintenanceLog>;

@Schema({ collection: 'operations_maintenance_logs', timestamps: true })
export class MaintenanceLog {
  @Prop({ required: true, uppercase: true, trim: true, index: true })
  vehicleReg: string;

  @Prop({
    required: true,
    enum: ['ROUTINE_SERVICE', 'BREAKDOWN_REPAIR', 'TIRE_REPLACEMENT', 'BATTERY_HEALTH'],
    default: 'ROUTINE_SERVICE',
  })
  maintenanceType: string;

  @Prop({ required: true, trim: true })
  garageName: string;

  @Prop({ required: true, min: 0 })
  odometer: number;

  @Prop({ required: true, min: 0 })
  costRupees: number;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ default: 0 })
  downtimeHours: number;

  @Prop({ default: () => new Date().toISOString().split('T')[0] })
  serviceDate: string;

  @Prop({ default: '' })
  invoiceNumber: string;
}

export const MaintenanceLogSchema = SchemaFactory.createForClass(MaintenanceLog);
MaintenanceLogSchema.index({ vehicleReg: 1, createdAt: -1 });

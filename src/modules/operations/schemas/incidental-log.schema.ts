import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type IncidentalLogDocument = HydratedDocument<IncidentalLog>;

@Schema({ collection: 'operations_incidental_logs', timestamps: true })
export class IncidentalLog {
  @Prop({ required: true, uppercase: true, trim: true, index: true })
  vehicleReg: string;

  @Prop({ required: true, trim: true })
  driverName: string;

  @Prop({
    required: true,
    enum: ['TOLL_PLAZA', 'PUNCTURE_REPAIR', 'MUNICIPAL_PARKING', 'VEHICLE_WASH'],
    default: 'TOLL_PLAZA',
  })
  expenseType: string;

  @Prop({ required: true, min: 0 })
  amountRupees: number;

  @Prop({ default: '' })
  notes: string;

  @Prop({ default: () => new Date().toISOString() })
  incurredAt: string;
}

export const IncidentalLogSchema = SchemaFactory.createForClass(IncidentalLog);

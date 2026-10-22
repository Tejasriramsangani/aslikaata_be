import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type YardReconciliationDocument = HydratedDocument<YardReconciliation>;

@Schema({ collection: 'operations_yard_reconciliations', timestamps: true })
export class YardReconciliation {
  @Prop({ default: () => new Date().toISOString().split('T')[0] })
  date: string;

  @Prop({ required: true, uppercase: true, trim: true })
  vehicleReg: string;

  @Prop({ default: '' })
  collectorCode: string;

  @Prop({ required: true, trim: true })
  collectorName: string;

  @Prop({ default: 'Vijayawada Central' })
  routeDivision: string;

  @Prop({ default: 0 })
  expectedFieldPickupsCount: number;

  @Prop({ required: true, default: 0 })
  reportedFieldTotalKg: number;

  @Prop({ required: true, default: 0 })
  physicalYardScaleKg: number;

  @Prop({ default: 0 })
  weightVarianceKg: number;

  @Prop({ default: 0 })
  variancePercentage: number;

  @Prop({
    default: 'PERFECT_MATCH',
    enum: ['PERFECT_MATCH', 'ACCEPTABLE_TOLERANCE', 'WEIGHT_SHORTAGE_FLAGGED'],
  })
  status: string;

  @Prop({ default: () => new Date().toLocaleTimeString() })
  verifiedAt: string;

  @Prop({ default: 'K. Venkat Rao' })
  supervisorName: string;

  @Prop({ default: '' })
  auditNotes: string;
}

export const YardReconciliationSchema = SchemaFactory.createForClass(YardReconciliation);

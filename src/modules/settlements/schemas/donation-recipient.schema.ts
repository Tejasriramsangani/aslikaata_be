import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DonationRecipientDocument = HydratedDocument<DonationRecipient>;

@Schema({ collection: 'donationrecipients', timestamps: true })
export class DonationRecipient {
  @Prop({ required: true, trim: true })
  name: string; // e.g. "Green Earth Foundation", "Goonj"

  @Prop({ required: true, trim: true })
  registrationNumber: string; // NGO Registration / 80G number

  @Prop({ default: '', trim: true })
  causeDescription: string;

  @Prop({ type: Object, default: {} })
  accountDetails?: Record<string, any>;

  @Prop({ default: 0 })
  displayOrder: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const DonationRecipientSchema = SchemaFactory.createForClass(DonationRecipient);
DonationRecipientSchema.index({ displayOrder: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type HolidayDocument = HydratedDocument<Holiday>;

export enum HolidayScope {
  ALL = 'ALL',
  VEHICLES = 'VEHICLES',
  DIVISIONS = 'DIVISIONS',
}

export enum HolidayHandling {
  NEXT_WORKING_DAY = 'NEXT_WORKING_DAY',
  NEXT_WEEK_SAME_DAY = 'NEXT_WEEK_SAME_DAY',
}

@Schema({ collection: 'holidays', timestamps: true })
export class Holiday {
  @Prop({ required: true, trim: true, index: true })
  date: string; // YYYY-MM-DD

  @Prop({ required: true, trim: true })
  name: string; // e.g. "Ugadi", "Independence Day"

  @Prop({ type: String, enum: HolidayScope, default: HolidayScope.ALL })
  scope: HolidayScope;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Vehicle' }], default: [] })
  vehicleIds: string[];

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Division' }], default: [] })
  divisionIds: string[];

  @Prop({ type: String, enum: HolidayHandling, default: HolidayHandling.NEXT_WORKING_DAY })
  handling: HolidayHandling;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  createdBy?: string | null;
}

export const HolidaySchema = SchemaFactory.createForClass(Holiday);
HolidaySchema.index({ date: 1 });

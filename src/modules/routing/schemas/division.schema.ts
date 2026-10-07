import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DivisionDocument = HydratedDocument<Division>;

@Schema({ _id: false })
export class GeoPolygon {
  @Prop({ type: String, enum: ['Polygon'], default: 'Polygon' })
  type: string;

  @Prop({ type: [[[Number]]], required: true }) // Coordinates array [ [ [lng, lat], ... ] ]
  coordinates: number[][][];
}
export const GeoPolygonSchema = SchemaFactory.createForClass(GeoPolygon);

@Schema({ collection: 'divisions', timestamps: true })
export class Division {
  @Prop({ required: true, trim: true })
  name: string; // e.g. "Vijayawada Central", "Benz Circle Division"

  @Prop({ required: true, unique: true, uppercase: true, trim: true, index: true })
  code: string; // e.g. "DIV-VJA-01"

  @Prop({ type: GeoPolygonSchema, required: false })
  boundary?: GeoPolygon;

  @Prop({ type: [String], default: [], index: true })
  pincodes: string[]; // e.g. ["520001", "520002", "520010"]

  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const DivisionSchema = SchemaFactory.createForClass(Division);
DivisionSchema.index({ boundary: '2dsphere' });
DivisionSchema.index({ pincodes: 1 });
DivisionSchema.index({ isActive: 1 });

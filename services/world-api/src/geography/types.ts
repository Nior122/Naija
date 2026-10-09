import type { Point2D } from "../multiplayer/types.js";

export interface GeographicCoordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface GeographicBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface GeographicFrame {
  readonly projection: "local-equirectangular-v1";
  readonly origin: GeographicCoordinate;
  readonly earth_radius_m: number;
  readonly game_units_per_meter: number;
  readonly precision_meters: number;
  readonly coordinate_decimal_places: number;
  readonly axis_convention: "x-east-y-south";
}

export interface GeographicLocation extends GeographicCoordinate {
  readonly world_id: "nigeria-main";
  readonly region_id: string;
  readonly country_id: "NG";
  readonly state_id: string;
  readonly lga_id: string;
  readonly settlement_id: string | null;
  readonly ward_id: string | null;
  readonly local_position_m: Point2D;
  readonly chunk_id: string;
}

export type GeoJSONGeometry =
  | { readonly type: "Point"; readonly coordinates: readonly number[] }
  | { readonly type: "MultiPoint"; readonly coordinates: readonly (readonly number[])[] }
  | { readonly type: "LineString"; readonly coordinates: readonly (readonly number[])[] }
  | {
      readonly type: "MultiLineString";
      readonly coordinates: readonly (readonly (readonly number[])[])[];
    }
  | {
      readonly type: "Polygon";
      readonly coordinates: readonly (readonly (readonly number[])[])[];
    }
  | {
      readonly type: "MultiPolygon";
      readonly coordinates: readonly (readonly (readonly (readonly number[])[])[])[];
    };

export interface GeographicAsset {
  readonly id: string;
  readonly kind:
    | "road"
    | "building"
    | "waterway"
    | "landuse"
    | "health_facility"
    | "school";
  readonly name: string | null;
  readonly source_layer: string;
  readonly osm_id: string;
  readonly lga_id: string;
  readonly geometry: GeoJSONGeometry;
  readonly chunk_ids: readonly string[];
}

export interface GeographicRegion {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly id: string;
  readonly name: string;
  readonly state_id: string;
  readonly lga_id: string;
  readonly settlement_id: string;
  readonly frame: GeographicFrame;
  readonly viewport: {
    readonly bounds_wgs84: GeographicBounds;
    readonly width: number;
    readonly height: number;
  };
  readonly chunk_grid: {
    readonly id_scheme: "ng-equirectangular-9n-v1";
    readonly size_meters: number;
    readonly central_latitude_degrees: number;
    readonly interest_radius_chunks: number;
  };
  readonly settlement: {
    readonly id: string;
    readonly name: string;
    readonly state_id: string;
    readonly related_lga_ids: readonly string[];
    readonly relationship_note: string;
    readonly coordinate: null;
    readonly coordinate_note: string;
  };
  readonly wards: readonly {
    readonly id: string;
    readonly name: string;
    readonly lga_id: string;
    readonly coordinate: GeographicCoordinate;
    readonly coordinate_role: "published_reference_point";
  }[];
  readonly spawn_location: GeographicLocation;
  readonly features: readonly GeographicAsset[];
  readonly feature_counts: Readonly<Record<string, number>>;
  readonly extensions: {
    readonly regional_environment_profile_id: null;
    readonly transport_network_id: null;
  };
  readonly streaming: {
    readonly content_chunk_ids: readonly string[];
    readonly client_chunk_radius: number;
    readonly notes: string;
  };
  readonly attribution: {
    readonly text: string;
    readonly license: "ODbL-1.0";
    readonly source_url: string;
  };
}

export interface NigerianAdminData {
  readonly schema_version: 1;
  readonly world_id: "nigeria-main";
  readonly country: {
    readonly id: "NG";
    readonly name: "Nigeria";
    readonly iso_3166_1_alpha2: "NG";
    readonly world_id: "nigeria-main";
  };
  readonly states: readonly {
    readonly id: string;
    readonly name: string;
    readonly source_code: string;
    readonly kind: "state" | "federal_capital_territory";
    readonly parent_id: "NG";
  }[];
  readonly lgas: readonly {
    readonly id: string;
    readonly name: string;
    readonly state_id: string;
    readonly coordinate: GeographicCoordinate;
    readonly coordinate_role: "published_reference_point";
    readonly source_record_id: number;
    readonly wikidata_id?: string;
  }[];
  readonly source_warnings: readonly string[];
  readonly coordinate_note: string;
}

export interface GeographyImportResult {
  readonly admin: NigerianAdminData;
  readonly region: GeographicRegion;
}

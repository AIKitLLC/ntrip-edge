/**
 * WGS-84 Geodetic (Latitude, Longitude, Ellipsoidal Height) <-> ECEF (X, Y, Z) coordinate transformations
 * and local East-North-Up (ENU) baseline geometry for RTK / VRS calculations.
 */

export interface GeodeticCoord {
  /** Latitude in decimal degrees (-90 to +90). */
  readonly latDeg: number;
  /** Longitude in decimal degrees (-180 to +180). */
  readonly lonDeg: number;
  /** Ellipsoidal height in meters. */
  readonly heightM: number;
}

export interface EcefCoord {
  /** ECEF X in meters. */
  readonly xM: number;
  /** ECEF Y in meters. */
  readonly yM: number;
  /** ECEF Z in meters. */
  readonly zM: number;
}

export interface BaselineVector {
  readonly eastM: number;
  readonly northM: number;
  readonly upM: number;
  readonly horizontalDistanceM: number;
  readonly slantDistanceM: number;
  readonly distanceKm: number;
}

// WGS-84 ellipsoid constants
const WGS84_A = 6378137.0; // Semi-major axis (m)
const WGS84_F = 1.0 / 298.257223563; // Flattening
const WGS84_B = WGS84_A * (1.0 - WGS84_F); // Semi-minor axis (m)
const WGS84_E2 = 2.0 * WGS84_F - WGS84_F * WGS84_F; // First eccentricity squared
const WGS84_EP2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_B * WGS84_B); // Second eccentricity squared

const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;

/**
 * Convert WGS-84 Geodetic coordinates to Earth-Centered, Earth-Fixed (ECEF) Cartesian coordinates in meters.
 */
export function geodeticToEcef(coord: GeodeticCoord): EcefCoord {
  const lat = coord.latDeg * DEG_TO_RAD;
  const lon = coord.lonDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const n = WGS84_A / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
  const xM = (n + coord.heightM) * cosLat * cosLon;
  const yM = (n + coord.heightM) * cosLat * sinLon;
  const zM = (n * (1.0 - WGS84_E2) + coord.heightM) * sinLat;

  return {
    xM: Math.round(xM * 10000) / 10000,
    yM: Math.round(yM * 10000) / 10000,
    zM: Math.round(zM * 10000) / 10000,
  };
}

/**
 * Convert ECEF (X, Y, Z) in meters to WGS-84 Geodetic (latDeg, lonDeg, heightM) using Bowring's method.
 */
export function ecefToGeodetic(ecef: EcefCoord): GeodeticCoord {
  const { xM, yM, zM } = ecef;
  const p = Math.hypot(xM, yM);
  if (p < 1e-9) {
    const sign = zM >= 0 ? 1 : -1;
    return {
      latDeg: sign * 90,
      lonDeg: 0,
      heightM: Math.abs(zM) - WGS84_B,
    };
  }

  const theta = Math.atan2(zM * WGS84_A, p * WGS84_B);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const lat = Math.atan2(
    zM + WGS84_EP2 * WGS84_B * sinTheta * sinTheta * sinTheta,
    p - WGS84_E2 * WGS84_A * cosTheta * cosTheta * cosTheta
  );
  const lon = Math.atan2(yM, xM);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
  const heightM = p / cosLat - n;

  return {
    latDeg: Math.round(lat * RAD_TO_DEG * 1e7) / 1e7,
    lonDeg: Math.round(lon * RAD_TO_DEG * 1e7) / 1e7,
    heightM: Math.round(heightM * 10000) / 10000,
  };
}

/**
 * Great-circle Haversine distance in kilometers between two latitude/longitude points.
 */
export function haversineDistanceKm(a: { latDeg: number; lonDeg: number }, b: { latDeg: number; lonDeg: number }): number {
  const dLat = (b.latDeg - a.latDeg) * DEG_TO_RAD;
  const dLon = (b.lonDeg - a.lonDeg) * DEG_TO_RAD;
  const lat1 = a.latDeg * DEG_TO_RAD;
  const lat2 = b.latDeg * DEG_TO_RAD;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  return Math.round(6371.0088 * c * 1000) / 1000;
}

/**
 * Compute local East-North-Up (ENU) baseline vector from reference station `base` to `rover`.
 */
export function computeBaselineEnu(base: GeodeticCoord, rover: GeodeticCoord): BaselineVector {
  const baseEcef = geodeticToEcef(base);
  const roverEcef = geodeticToEcef(rover);

  const dx = roverEcef.xM - baseEcef.xM;
  const dy = roverEcef.yM - baseEcef.yM;
  const dz = roverEcef.zM - baseEcef.zM;

  const lat = base.latDeg * DEG_TO_RAD;
  const lon = base.lonDeg * DEG_TO_RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  const eastM = -sinLon * dx + cosLon * dy;
  const northM = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const upM = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;
  const horizontalDistanceM = Math.hypot(eastM, northM);
  const slantDistanceM = Math.hypot(eastM, northM, upM);

  return {
    eastM: Math.round(eastM * 1000) / 1000,
    northM: Math.round(northM * 1000) / 1000,
    upM: Math.round(upM * 1000) / 1000,
    horizontalDistanceM: Math.round(horizontalDistanceM * 1000) / 1000,
    slantDistanceM: Math.round(slantDistanceM * 1000) / 1000,
    distanceKm: Math.round((slantDistanceM / 1000) * 1000) / 1000,
  };
}

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types/env";
import {
  base64ToBytes,
  buildNmeaGga,
  bytesToBase64,
  bytesToHex,
  computeBaselineEnu,
  decodeRtcm3Stream,
  encodeRtcm1005,
  encodeRtcm1006,
  encodeRtcm1033,
  encodeRtcm1230,
  encodeRtcm4072Extension,
  findNearestStation,
  getAllStations,
  getDefaultSourcetableRecords,
  hexToBytes,
  haversineDistanceKm,
  listCustomConfigs,
  parseNmeaGga,
  parseSourcetable,
  registerValidatedConfig,
  serializeSourcetable,
  simulateGnssEpoch,
  createIcpIiChallenge,
  validateNtripConfigAgainstSpecs,
  verifyIcpIiChallenge,
  verifyIcpSessionToken,
  type GeodeticCoord,
  type NmeaFixQuality,
} from "../protocol";

export const apiRouter = new Hono<{ Bindings: Env }>();

const SourcetableParseSchema = z.object({
  sourcetable: z.string().min(1, "sourcetable text is required").max(65536),
});

const RtcmDecodeSchema = z.object({
  payload: z.string().min(2, "payload is required").max(131072),
  encoding: z.enum(["hex", "base64", "auto"]).optional().default("auto"),
});

const RtcmEncodeSchema = z.object({
  messageNumber: z.union([
    z.literal(1005),
    z.literal(1006),
    z.literal(1033),
    z.literal(1230),
    z.literal(4072),
  ]).default(1005),
  stationId: z.number().int().min(0).max(4095).default(1001),
  latDeg: z.number().min(-90).max(90).default(21.028511),
  lonDeg: z.number().min(-180).max(180).default(105.804817),
  heightM: z.number().min(-1000).max(15000).default(24.8),
  antennaHeightM: z.number().min(0).max(6.5535).optional().default(1.8),
  antennaDescriptor: z.string().max(31).optional().default("SEPCHOKE_B3E6   SPKE"),
  receiverDescriptor: z.string().max(31).optional().default("AIKIT EDGE VRS 2.0"),
  telemetry: z.record(z.unknown()).optional(),
});

const NmeaGgaSchema = z.object({
  gga: z.string().max(256).optional(),
  latDeg: z.number().min(-90).max(90).optional(),
  lonDeg: z.number().min(-180).max(180).optional(),
  heightM: z.number().min(-1000).max(15000).optional().default(25.0),
  fixQuality: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4), z.literal(5)]).optional().default(4),
  satellitesUsed: z.number().int().min(0).max(64).optional().default(24),
  hdop: z.number().min(0.1).max(50).optional().default(0.6),
  stationId: z.number().int().min(0).max(4095).optional().default(1001),
});

// 1. GET /api/v1/sourcetable — JSON + raw NTRIP Sourcetable + optional VRS distance sorting
apiRouter.get("/sourcetable", (c) => {
  const url = new URL(c.req.url);
  const host = url.hostname || "ntrip.ai-kit.net";
  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 2101;
  const records = getDefaultSourcetableRecords(host, port);
  const rawSourcetable = serializeSourcetable(records);
  const parsed = parseSourcetable(rawSourcetable);

  let roverCoord: { latDeg: number; lonDeg: number } | null = null;
  const ggaParam = c.req.query("gga");
  const latParam = c.req.query("lat");
  const lonParam = c.req.query("lon");

  if (ggaParam) {
    const ggaParsed = parseNmeaGga(ggaParam);
    if (ggaParsed.ok) {
      roverCoord = { latDeg: ggaParsed.record.latDeg, lonDeg: ggaParsed.record.lonDeg };
    }
  } else if (latParam !== undefined && lonParam !== undefined) {
    const lat = Number.parseFloat(latParam);
    const lon = Number.parseFloat(lonParam);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      roverCoord = { latDeg: lat, lonDeg: lon };
    }
  }

  const nearest = roverCoord ? findNearestStation(roverCoord) : null;
  const streamsWithDistance = parsed.streams.map((s) => ({
    ...s,
    distanceKm:
      roverCoord && s.solution === 0
        ? haversineDistanceKm(roverCoord, { latDeg: s.latitude, lonDeg: s.longitude })
        : null,
  }));

  return c.json({
    success: true,
    protocol: "NTRIP/2.0",
    caster: {
      host,
      port,
      operator: c.env?.CASTER_OPERATOR ?? "AI Kit LLC",
      identifier: c.env?.CASTER_IDENTIFIER ?? "AIKIT-EDGE-CASTER",
    },
    roverCoord,
    nearestStation: nearest
      ? {
          mountpoint: nearest.station.mountpoint,
          city: nearest.station.city,
          country: nearest.station.country,
          distanceKm: nearest.distanceKm,
          recommendedMountpoint: nearest.distanceKm <= 35 ? nearest.station.mountpoint : "VRS-AUTO",
        }
      : null,
    streams: streamsWithDistance,
    casters: parsed.casters,
    networks: parsed.networks,
    rawSourcetable,
  });
});

// 2. POST /api/v1/sourcetable/parse — Validate and parse custom Sourcetable text
apiRouter.post("/sourcetable/parse", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsedBody = SourcetableParseSchema.safeParse(body);
  if (!parsedBody.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_SOURCETABLE_INPUT",
          message: parsedBody.error.issues.map((i) => i.message).join("; "),
        },
      },
      400
    );
  }

  const result = parseSourcetable(parsedBody.data.sourcetable);
  return c.json({
    success: true,
    summary: {
      streamCount: result.streams.length,
      casterCount: result.casters.length,
      networkCount: result.networks.length,
      warningCount: result.warnings.length,
      hasEndSourcetable: result.hasEndSourcetable,
    },
    ...result,
  });
});

// 3. POST /api/v1/rtcm/decode — Decode binary RTCM 3.x frames (hex or base64) and verify CRC-24Q
apiRouter.post("/rtcm/decode", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsedBody = RtcmDecodeSchema.safeParse(body);
  if (!parsedBody.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_RTCM_INPUT",
          message: parsedBody.error.issues.map((i) => i.message).join("; "),
        },
      },
      400
    );
  }

  const { payload, encoding } = parsedBody.data;
  let bytes: Uint8Array | null = null;
  if (encoding === "hex") {
    bytes = hexToBytes(payload);
  } else if (encoding === "base64") {
    bytes = base64ToBytes(payload);
  } else {
    bytes = hexToBytes(payload) ?? base64ToBytes(payload);
  }

  if (!bytes || bytes.length === 0) {
    return c.json(
      {
        success: false,
        error: {
          code: "DECODE_PARSE_ERROR",
          message: "Input could not be parsed as valid hexadecimal or base64 bytes.",
        },
      },
      400
    );
  }

  const frames = decodeRtcm3Stream(bytes);
  const validCrcCount = frames.filter((f) => f.crcValid).length;

  return c.json({
    success: true,
    inputLengthBytes: bytes.length,
    frameCount: frames.length,
    validCrcCount,
    allCrcValid: frames.length > 0 && validCrcCount === frames.length,
    frames,
  });
});

// 4. POST /api/v1/rtcm/encode — Synthesize custom RTCM 3.x binary frame with CRC-24Q
apiRouter.post("/rtcm/encode", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsedBody = RtcmEncodeSchema.safeParse(body);
  if (!parsedBody.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_ENCODE_INPUT",
          message: parsedBody.error.issues.map((i) => i.message).join("; "),
        },
      },
      400
    );
  }

  const d = parsedBody.data;
  const geodetic: GeodeticCoord = {
    latDeg: d.latDeg,
    lonDeg: d.lonDeg,
    heightM: d.heightM,
  };

  let frameBytes: Uint8Array;
  switch (d.messageNumber) {
    case 1005:
      frameBytes = encodeRtcm1005({ stationId: d.stationId, geodetic });
      break;
    case 1006:
      frameBytes = encodeRtcm1006({
        stationId: d.stationId,
        geodetic,
        antennaHeightM: d.antennaHeightM,
      });
      break;
    case 1033:
      frameBytes = encodeRtcm1033({
        stationId: d.stationId,
        antennaDescriptor: d.antennaDescriptor,
        receiverTypeDescriptor: d.receiverDescriptor,
      });
      break;
    case 1230:
      frameBytes = encodeRtcm1230(d.stationId);
      break;
    case 4072:
      frameBytes = encodeRtcm4072Extension(
        d.stationId,
        d.telemetry ?? {
          stationId: d.stationId,
          lat: d.latDeg,
          lon: d.lonDeg,
          h: d.heightM,
          proto: "NTRIP/2.0-EXT",
        }
      );
      break;
  }

  const decodedFrames = decodeRtcm3Stream(frameBytes);

  return c.json({
    success: true,
    messageNumber: d.messageNumber,
    totalLengthBytes: frameBytes.length,
    rawHex: bytesToHex(frameBytes),
    rawBase64: bytesToBase64(frameBytes),
    frame: decodedFrames[0] ?? null,
  });
});

// 5. POST /api/v1/nmea/gga — Parse or build $GNGGA sentence and compute nearest station / ENU baseline
apiRouter.post("/nmea/gga", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsedBody = NmeaGgaSchema.safeParse(body);
  if (!parsedBody.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_GGA_INPUT",
          message: parsedBody.error.issues.map((i) => i.message).join("; "),
        },
      },
      400
    );
  }

  const d = parsedBody.data;
  let ggaString = d.gga?.trim();
  if (!ggaString) {
    const coord: GeodeticCoord = {
      latDeg: d.latDeg ?? 21.028511,
      lonDeg: d.lonDeg ?? 105.804817,
      heightM: d.heightM,
    };
    ggaString = buildNmeaGga({
      coord,
      fixQuality: d.fixQuality as NmeaFixQuality,
      satellitesUsed: d.satellitesUsed,
      hdop: d.hdop,
      diffStationId: d.stationId,
    });
  }

  const parsed = parseNmeaGga(ggaString);
  if (!parsed.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: "NMEA_PARSE_ERROR",
          message: parsed.error,
        },
      },
      400
    );
  }

  const roverCoord: GeodeticCoord = {
    latDeg: parsed.record.latDeg,
    lonDeg: parsed.record.lonDeg,
    heightM: parsed.record.altitudeM,
  };
  const nearest = findNearestStation(roverCoord);
  const baselineFromNearest = computeBaselineEnu(nearest.station.coord, roverCoord);

  return c.json({
    success: true,
    gga: parsed.record,
    vrsRouting: {
      nearestPhysicalMountpoint: nearest.station.mountpoint,
      nearestCity: nearest.station.city,
      distanceKm: nearest.distanceKm,
      recommendedMountpoint: nearest.distanceKm <= 35 ? nearest.station.mountpoint : "VRS-AUTO",
      baselineEnu: baselineFromNearest,
    },
  });
});

// 6. GET /api/v1/simulate/epoch — Simulate one complete GNSS RTK epoch
apiRouter.get("/simulate/epoch", (c) => {
  const mountpoint = c.req.query("mountpoint") ?? "HAN0-VN";
  const epochIndex = Number.parseInt(c.req.query("epoch") ?? "4", 10) || 0;
  const ggaHeaderOrQuery = c.req.header("Ntrip-GGA") ?? c.req.query("gga");

  let roverCoordOverride: GeodeticCoord | undefined;
  if (ggaHeaderOrQuery) {
    const ggaParsed = parseNmeaGga(ggaHeaderOrQuery);
    if (ggaParsed.ok) {
      roverCoordOverride = {
        latDeg: ggaParsed.record.latDeg,
        lonDeg: ggaParsed.record.lonDeg,
        heightM: ggaParsed.record.altitudeM,
      };
    }
  } else {
    const rLat = c.req.query("roverLat");
    const rLon = c.req.query("roverLon");
    const rH = c.req.query("roverHeight");
    if (rLat !== undefined && rLon !== undefined) {
      const latDeg = Number.parseFloat(rLat);
      const lonDeg = Number.parseFloat(rLon);
      const heightM = rH !== undefined ? Number.parseFloat(rH) : 25.0;
      if (Number.isFinite(latDeg) && Number.isFinite(lonDeg) && Math.abs(latDeg) <= 90 && Math.abs(lonDeg) <= 180) {
        roverCoordOverride = { latDeg, lonDeg, heightM: Number.isFinite(heightM) ? heightM : 25.0 };
      }
    }
  }

  let baseCoordOverride: GeodeticCoord | undefined;
  const bLat = c.req.query("baseLat");
  const bLon = c.req.query("baseLon");
  const bH = c.req.query("baseHeight");
  if (bLat !== undefined && bLon !== undefined) {
    const latDeg = Number.parseFloat(bLat);
    const lonDeg = Number.parseFloat(bLon);
    const heightM = bH !== undefined ? Number.parseFloat(bH) : 24.8;
    if (Number.isFinite(latDeg) && Number.isFinite(lonDeg) && Math.abs(latDeg) <= 90 && Math.abs(lonDeg) <= 180) {
      baseCoordOverride = { latDeg, lonDeg, heightM: Number.isFinite(heightM) ? heightM : 24.8 };
    }
  }

  const extParam = c.req.query("ext4072");
  const includeExtension4072 = extParam === "true" || extParam === "1";

  const simOptions = {
    mountpoint,
    epochIndex,
    ...(baseCoordOverride ? { baseCoordOverride } : {}),
    ...(roverCoordOverride ? { roverCoordOverride } : {}),
    ...(extParam !== undefined ? { includeExtension4072 } : {}),
  };

  const epochResult = simulateGnssEpoch(simOptions);
  return c.json({
    success: true,
    stationsAvailable: getAllStations().map((s) => s.mountpoint),
    epoch: epochResult,
  });
});

const IcpVerifyBodySchema = z.object({
  challengeToken: z.string().min(10),
  publicKeyHex: z.string().min(32),
  signatureHex: z.string().optional(),
  principal: z.string().optional(),
  algorithm: z.enum(["ECDSA_P256", "ED25519", "ICP_DELEGATION"]).optional(),
});

const CustomConfigBodySchema = z.object({
  icpSessionToken: z.string().optional(),
  mountpoint: z.string().min(1).max(32),
  stationId: z.number().int(),
  identifier: z.string().min(1).max(64),
  city: z.string().min(1).max(48),
  country: z.string().min(1).max(8),
  latDeg: z.number(),
  lonDeg: z.number(),
  heightM: z.number(),
  format: z.string().optional(),
  formatDetails: z.string().optional(),
  carrier: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  navSystem: z.string().optional(),
  network: z.string().optional(),
  antennaDescriptor: z.string().optional(),
  receiverDescriptor: z.string().optional(),
  isVrs: z.boolean().optional(),
  bitrate: z.number().optional(),
  upstreamUrl: z.string().optional(),
  sampleRtcmHex: z.string().optional(),
});

// 8. GET & POST /api/v1/auth/icp-ii/challenge — Issue ICP Internet Identity (II) auth challenge
apiRouter.get("/auth/icp-ii/challenge", async (c) => {
  const url = new URL(c.req.url);
  const challenge = await createIcpIiChallenge(url.hostname || "ntrip.ai-kit.net");
  return c.json({
    success: true,
    challenge,
  });
});

apiRouter.post("/auth/icp-ii/challenge", async (c) => {
  const url = new URL(c.req.url);
  const challenge = await createIcpIiChallenge(url.hostname || "ntrip.ai-kit.net");
  return c.json({
    success: true,
    challenge,
  });
});

// 9. POST /api/v1/auth/icp-ii/verify — Verify ICP II signature/delegation and issue icp_ii_... session token
apiRouter.post("/auth/icp-ii/verify", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = IcpVerifyBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_ICP_II_VERIFY_INPUT",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        },
      },
      400
    );
  }

  const res = await verifyIcpIiChallenge({
    challengeToken: parsed.data.challengeToken,
    publicKeyHex: parsed.data.publicKeyHex,
    ...(parsed.data.signatureHex !== undefined ? { signatureHex: parsed.data.signatureHex } : {}),
    ...(parsed.data.principal !== undefined ? { principal: parsed.data.principal } : {}),
    ...(parsed.data.algorithm !== undefined ? { algorithm: parsed.data.algorithm } : {}),
  });

  if (!res.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: res.code,
          message: res.error,
        },
      },
      401
    );
  }

  return c.json({
    success: true,
    sessionToken: res.sessionToken,
    claims: res.claims,
  });
});

// 10. POST /api/v1/ntrip/validate — Validate candidate NTRIP server / mountpoint config against specs
apiRouter.post("/ntrip/validate", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CustomConfigBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_NTRIP_VALIDATE_INPUT",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        },
      },
      400
    );
  }

  const d = parsed.data;
  const report = await validateNtripConfigAgainstSpecs({
    mountpoint: d.mountpoint,
    stationId: d.stationId,
    identifier: d.identifier,
    city: d.city,
    country: d.country,
    latDeg: d.latDeg,
    lonDeg: d.lonDeg,
    heightM: d.heightM,
    ...(d.format !== undefined ? { format: d.format } : {}),
    ...(d.formatDetails !== undefined ? { formatDetails: d.formatDetails } : {}),
    ...(d.carrier !== undefined ? { carrier: d.carrier } : {}),
    ...(d.navSystem !== undefined ? { navSystem: d.navSystem } : {}),
    ...(d.network !== undefined ? { network: d.network } : {}),
    ...(d.antennaDescriptor !== undefined ? { antennaDescriptor: d.antennaDescriptor } : {}),
    ...(d.receiverDescriptor !== undefined ? { receiverDescriptor: d.receiverDescriptor } : {}),
    ...(d.isVrs !== undefined ? { isVrs: d.isVrs } : {}),
    ...(d.bitrate !== undefined ? { bitrate: d.bitrate } : {}),
    ...(d.upstreamUrl !== undefined ? { upstreamUrl: d.upstreamUrl } : {}),
    ...(d.sampleRtcmHex !== undefined ? { sampleRtcmHex: d.sampleRtcmHex } : {}),
  });

  return c.json(
    {
      success: report.compliant,
      validationReport: report,
    },
    report.compliant ? 200 : 422
  );
});

// 11. GET /api/v1/configs — List all active & custom registered NTRIP configurations
apiRouter.get("/configs", (c) => {
  return c.json({
    success: true,
    customConfigs: listCustomConfigs(),
    allStations: getAllStations(),
  });
});

// 12. POST /api/v1/configs — Create new NTRIP configuration (Requires ICP II login + full Spec Compliance)
apiRouter.post("/configs", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CustomConfigBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_NTRIP_CONFIG_INPUT",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        },
      },
      400
    );
  }

  const d = parsed.data;
  const tokenInput = d.icpSessionToken ?? c.req.header("Authorization");
  const authCheck = await verifyIcpSessionToken(tokenInput);
  if (!authCheck.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: "ICP_II_AUTH_REQUIRED",
          message: authCheck.error,
        },
      },
      401
    );
  }

  const report = await validateNtripConfigAgainstSpecs({
    mountpoint: d.mountpoint,
    stationId: d.stationId,
    identifier: d.identifier,
    city: d.city,
    country: d.country,
    latDeg: d.latDeg,
    lonDeg: d.lonDeg,
    heightM: d.heightM,
    ...(d.format !== undefined ? { format: d.format } : {}),
    ...(d.formatDetails !== undefined ? { formatDetails: d.formatDetails } : {}),
    ...(d.carrier !== undefined ? { carrier: d.carrier } : {}),
    ...(d.navSystem !== undefined ? { navSystem: d.navSystem } : {}),
    ...(d.network !== undefined ? { network: d.network } : {}),
    ...(d.antennaDescriptor !== undefined ? { antennaDescriptor: d.antennaDescriptor } : {}),
    ...(d.receiverDescriptor !== undefined ? { receiverDescriptor: d.receiverDescriptor } : {}),
    ...(d.isVrs !== undefined ? { isVrs: d.isVrs } : {}),
    ...(d.bitrate !== undefined ? { bitrate: d.bitrate } : {}),
    ...(d.upstreamUrl !== undefined ? { upstreamUrl: d.upstreamUrl } : {}),
    ...(d.sampleRtcmHex !== undefined ? { sampleRtcmHex: d.sampleRtcmHex } : {}),
  });

  if (!report.compliant) {
    return c.json(
      {
        success: false,
        error: {
          code: "NTRIP_SPEC_VALIDATION_FAILED",
          message:
            "Configuration failed RTCM 10410.1 (NTRIP v2.0) / RTCM 10403.3 (RTCM 3.x) specification validation.",
        },
        validationReport: report,
      },
      422
    );
  }

  const registered = registerValidatedConfig(authCheck.claims.principal, report);
  return c.json(
    {
      success: true,
      configId: registered.configId,
      ownerPrincipal: registered.ownerPrincipal,
      createdAtIso: registered.createdAtIso,
      station: registered.station,
      strRecord: registered.strRecord,
      strRecordLine: registered.strRecordLine,
      endpoints: {
        ntripStreamUrl: `https://ntrip.ai-kit.net/${registered.station.mountpoint}`,
        simulateEpochUrl: `https://ntrip.ai-kit.net/api/v1/simulate/epoch?mountpoint=${registered.station.mountpoint}`,
        sseStreamUrl: `https://ntrip.ai-kit.net/api/v1/stream/${registered.station.mountpoint}`,
      },
      validationReport: registered.validationReport,
    },
    201
  );
});

// 7. GET /api/v1/stream/:mountpoint — Bounded Server-Sent Events (SSE) real-time 1 Hz RTCM3 stream
apiRouter.get("/stream/:mountpoint", (c) => {
  const mountpoint = c.req.param("mountpoint") || "HAN0-VN";
  const epochsRequested = Number.parseInt(c.req.query("epochs") ?? "6", 10);
  const maxEpochs = Math.max(1, Math.min(20, Number.isFinite(epochsRequested) ? epochsRequested : 6));
  const intervalRequested = Number.parseInt(c.req.query("intervalMs") ?? "600", 10);
  const intervalMs = Math.max(0, Math.min(2000, Number.isFinite(intervalRequested) ? intervalRequested : 600));

  const ggaHeaderOrQuery = c.req.header("Ntrip-GGA") ?? c.req.query("gga");
  let roverCoordOverride: GeodeticCoord | undefined;
  if (ggaHeaderOrQuery) {
    const parsedGga = parseNmeaGga(ggaHeaderOrQuery);
    if (parsedGga.ok) {
      roverCoordOverride = {
        latDeg: parsedGga.record.latDeg,
        lonDeg: parsedGga.record.lonDeg,
        heightM: parsedGga.record.altitudeM,
      };
    }
  }

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < maxEpochs; i++) {
          if (cancelled) break;
          const epochData = simulateGnssEpoch({
            mountpoint,
            epochIndex: i,
            ...(roverCoordOverride ? { roverCoordOverride } : {}),
          });
          const sseBlock = `event: epoch\nid: ${i}\ndata: ${JSON.stringify(epochData)}\n\n`;
          controller.enqueue(encoder.encode(sseBlock));

          if (i + 1 < maxEpochs && intervalMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
          }
        }
        if (!cancelled) {
          controller.enqueue(encoder.encode(`event: complete\ndata: {"epochsSent":${maxEpochs}}\n\n`));
          controller.close();
        }
      } catch (err) {
        if (!cancelled) {
          controller.error(err);
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "Ntrip-Version": "Ntrip/2.0",
      "X-Ntrip-Mountpoint": mountpoint.toUpperCase(),
    },
  });
});

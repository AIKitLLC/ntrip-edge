/**
 * Model Context Protocol (MCP) JSON-RPC 2.0 Streamable HTTP Server (`/mcp`).
 *
 * Exposes tools for AI Agents to:
 * 1. Authenticate with ICP Internet Identity (II) (`icp_ii_auth_challenge`, `icp_ii_auth_verify`)
 * 2. Validate candidate NTRIP Rev 1 / Rev 2 / Dual-Stack servers & RTCM 3.x streams against RTCM 10410.0 / 10410.1 / 10403.3 specs (`validate_ntrip_server`)
 * 3. Create & register new spec-compliant NTRIP configurations (`create_ntrip_config` — strictly requires ICP II session token + passing spec validation)
 * 4. Compare NTRIP Rev 1 (v1.0) vs Rev 2 (v2.0) wire handshakes (`compare_ntrip_revisions`)
 * 5. Simulate GNSS RTK epochs (`simulate_rtk_epoch`) and decode RTCM 3.x frames (`decode_rtcm3_stream`)
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types/env";
import {
  buildNtripWireTranscript,
  createIcpIiChallenge,
  decodeRtcm3Stream,
  hexToBytes,
  registerValidatedConfig,
  simulateGnssEpoch,
  validateNtripConfigAgainstSpecs,
  verifyIcpIiChallenge,
  verifyIcpSessionToken,
} from "../protocol";

export const mcpRouter = new Hono<{ Bindings: Env }>();

export const MCP_TOOLS = [
  {
    name: "icp_ii_auth_challenge",
    description:
      "Step 1 of ICP Internet Identity (II) login: request a signed challenge message to sign with an ICP Internet Identity delegation or WebCrypto ECDSA-P256 / Ed25519 session key.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Relying party domain (default: ntrip.ai-kit.net)",
        },
      },
    },
  },
  {
    name: "icp_ii_auth_verify",
    description:
      "Step 2 of ICP Internet Identity (II) login: verify the signed challenge or ICP II delegation public key, derive/validate the CRC-32 + Base32 ICP Principal, and obtain an 'icp_ii_...' session token required by create_ntrip_config.",
    inputSchema: {
      type: "object",
      required: ["challengeToken", "publicKeyHex"],
      properties: {
        challengeToken: {
          type: "string",
          description: "The challengeToken returned by icp_ii_auth_challenge",
        },
        publicKeyHex: {
          type: "string",
          description: "Hex-encoded DER/SPKI or raw session public key from ICP Internet Identity",
        },
        signatureHex: {
          type: "string",
          description: "Optional hex-encoded signature over challengeMessage",
        },
        principal: {
          type: "string",
          description: "Optional explicit ICP Principal (must pass CRC-32 + Base32 validation and not be anonymous 2vxsx-fae)",
        },
        algorithm: {
          type: "string",
          enum: ["ECDSA_P256", "ED25519", "ICP_DELEGATION"],
        },
      },
    },
  },
  {
    name: "validate_ntrip_server",
    description:
      "Validate an NTRIP Caster/Server configuration (Rev 1 v1.0, Rev 2 v2.0, or Dual-Stack), STR record, binary RTCM 3.x stream, and optional live upstream URL against RTCM 10410.0 / 10410.1 and RTCM 10403.3 specifications.",
    inputSchema: {
      type: "object",
      required: ["mountpoint", "stationId", "identifier", "city", "country", "latDeg", "lonDeg", "heightM"],
      properties: {
        mountpoint: { type: "string", description: "Mountpoint token (1..32 ASCII chars, e.g. 'DANANG-VN')" },
        stationId: { type: "integer", description: "12-bit RTCM DF003 Reference Station ID (0..4095)" },
        identifier: { type: "string", description: "Human-readable station name" },
        city: { type: "string", description: "City name" },
        country: { type: "string", description: "ISO 3166-1 alpha-3 country code (e.g. 'VNM', 'USA', 'DEU')" },
        latDeg: { type: "number", description: "WGS-84 Latitude in decimal degrees (-90..90)" },
        lonDeg: { type: "number", description: "WGS-84 Longitude in decimal degrees (-180..180)" },
        heightM: { type: "number", description: "Ellipsoidal height in meters (-1000..15000)" },
        ntripRevision: {
          type: "string",
          enum: ["rev1", "rev2", "dual"],
          description: "Server protocol revision: 'rev1' (NTRIP v1.0 ICY 200 OK / SOURCE), 'rev2' (NTRIP v2.0 HTTP/1.1 gnss/data), or 'dual' (both)",
        },
        sourcePassword: {
          type: "string",
          description: "Source password for NTRIP Rev 1 'SOURCE <pwd> /<mountpoint>' or Rev 2 Basic Auth (4..64 non-whitespace chars)",
        },
        formatDetails: {
          type: "string",
          description: "RTCM 3.x message schedule (must include ARP 1005/1006 + observables, e.g. '1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)')",
        },
        antennaDescriptor: { type: "string", description: "IERS/IGS Antenna descriptor (max 31 chars)" },
        receiverDescriptor: { type: "string", description: "GNSS Receiver type descriptor (max 31 chars)" },
        isVrs: { type: "boolean", description: "Whether this mountpoint requires Rover NMEA GGA for VRS" },
        bitrate: { type: "integer", description: "Stream bitrate in bps (1200..256000)" },
        upstreamUrl: { type: "string", description: "Optional live NTRIP v1.0/v2.0 URL to probe (HTTP handshake & stream check)" },
        sampleRtcmHex: { type: "string", description: "Optional hex-encoded binary RTCM 3.x frames to validate CRC-24Q & ARP" },
      },
    },
  },
  {
    name: "create_ntrip_config",
    description:
      "Create and register a new live NTRIP Mountpoint & Caster configuration (supporting 'rev1', 'rev2', or 'dual'). REQUIRES a valid 'icpSessionToken' (from ICP Internet Identity login via icp_ii_auth_verify) AND requires the configuration to pass all RTCM 10410.0 / 10410.1 / 10403.3 specification checks.",
    inputSchema: {
      type: "object",
      required: [
        "icpSessionToken",
        "mountpoint",
        "stationId",
        "identifier",
        "city",
        "country",
        "latDeg",
        "lonDeg",
        "heightM",
      ],
      properties: {
        icpSessionToken: {
          type: "string",
          description: "Bearer token ('icp_ii_...') obtained after authenticating with ICP Internet Identity",
        },
        mountpoint: { type: "string", description: "Mountpoint token (1..32 ASCII chars, e.g. 'DANANG-VN')" },
        stationId: { type: "integer", description: "12-bit RTCM Reference Station ID (0..4095)" },
        identifier: { type: "string", description: "Station identifier" },
        city: { type: "string", description: "City name" },
        country: { type: "string", description: "3-letter ISO country code (e.g. 'VNM')" },
        latDeg: { type: "number", description: "WGS-84 Latitude (-90..90)" },
        lonDeg: { type: "number", description: "WGS-84 Longitude (-180..180)" },
        heightM: { type: "number", description: "Ellipsoidal height in meters (-1000..15000)" },
        ntripRevision: {
          type: "string",
          enum: ["rev1", "rev2", "dual"],
          description: "Server protocol revision: 'rev1' (NTRIP v1.0), 'rev2' (NTRIP v2.0), or 'dual' (both)",
        },
        sourcePassword: { type: "string" },
        formatDetails: { type: "string", description: "RTCM 3.x message schedule" },
        antennaDescriptor: { type: "string" },
        receiverDescriptor: { type: "string" },
        isVrs: { type: "boolean" },
        bitrate: { type: "integer" },
        upstreamUrl: { type: "string" },
        sampleRtcmHex: { type: "string" },
      },
    },
  },
  {
    name: "compare_ntrip_revisions",
    description:
      "Generate side-by-side NTRIP Rev 1 (v1.0 — RTCM 10410.0) vs NTRIP Rev 2 (v2.0 — RTCM 10410.1) wire-level client/server/caster handshake transcripts and protocol specifications.",
    inputSchema: {
      type: "object",
      properties: {
        mountpoint: { type: "string", description: "Mountpoint name (default: 'HAN0-VN')" },
        sourcePassword: { type: "string", description: "Source password (default: 'ntrip123')" },
      },
    },
  },
  {
    name: "simulate_rtk_epoch",
    description:
      "Simulate a complete 1 Hz GNSS RTK epoch (binary RTCM 3.x frames, decoded telemetry, Rover $GNGGA, and RTK ambiguity resolution metrics) for any default or custom mountpoint.",
    inputSchema: {
      type: "object",
      properties: {
        mountpoint: { type: "string", description: "Mountpoint name (e.g. 'HAN0-VN', 'VRS-AUTO', or a custom created mountpoint)" },
        epochIndex: { type: "integer", description: "Epoch number (0 = DGPS, 1..2 = RTK_FLOAT, >=3 = RTK_FIXED)" },
      },
    },
  },
  {
    name: "decode_rtcm3_stream",
    description: "Decode a hexadecimal binary RTCM 3.x stream and verify 24-bit Qualcomm CRC-24Q checksums.",
    inputSchema: {
      type: "object",
      required: ["hexPayload"],
      properties: {
        hexPayload: { type: "string", description: "Hex-encoded RTCM 3.x frames starting with D3" },
      },
    },
  },
] as const;

const ValidateInputSchema = z.object({
  mountpoint: z.string().min(1),
  stationId: z.number(),
  identifier: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
  latDeg: z.number(),
  lonDeg: z.number(),
  heightM: z.number(),
  ntripRevision: z.enum(["rev1", "rev2", "dual"]).optional(),
  sourcePassword: z.string().optional(),
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

mcpRouter.get("/mcp", (c) => {
  return c.json({
    name: "aikit-ntrip-edge-mcp",
    version: "1.2.0",
    protocolVersion: "2024-11-05",
    transport: "Streamable HTTP (JSON-RPC 2.0 POST /mcp)",
    supportedNtripRevisions: ["rev1 (NTRIP v1.0 / RTCM 10410.0)", "rev2 (NTRIP v2.0 / RTCM 10410.1)", "dual"],
    authenticationRequirement:
      "Creating new NTRIP configurations (create_ntrip_config) requires ICP Internet Identity (II) authentication via icp_ii_auth_challenge + icp_ii_auth_verify AND passing RTCM 10410.0 / 10410.1 / 10403.3 specification validation.",
    tools: MCP_TOOLS,
    docsUrl: "https://ntrip.ai-kit.net/llm.txt",
  });
});

mcpRouter.post("/mcp", async (c) => {
  const rpc = (await c.req.json().catch(() => null)) as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  } | null;

  if (!rpc || rpc.jsonrpc !== "2.0" || !rpc.method) {
    return c.json(
      {
        jsonrpc: "2.0",
        id: rpc?.id ?? null,
        error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" },
      },
      400
    );
  }

  const id = rpc.id ?? null;

  if (rpc.method === "initialize") {
    return c.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: "aikit-ntrip-edge-mcp",
          version: "1.2.0",
        },
        instructions:
          "Use icp_ii_auth_challenge and icp_ii_auth_verify to authenticate via ICP Internet Identity (II). Supports both NTRIP Rev 1 (v1.0) and Rev 2 (v2.0) server validation and configuration.",
      },
    });
  }

  if (rpc.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (rpc.method === "ping") {
    return c.json({ jsonrpc: "2.0", id, result: {} });
  }

  if (rpc.method === "tools/list") {
    return c.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: MCP_TOOLS,
      },
    });
  }

  if (rpc.method === "tools/call") {
    const toolName = typeof rpc.params?.name === "string" ? rpc.params.name : "";
    const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;

    if (toolName === "icp_ii_auth_challenge") {
      const domain = typeof args.domain === "string" ? args.domain : "ntrip.ai-kit.net";
      const challenge = await createIcpIiChallenge(domain);
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(challenge, null, 2) }],
        },
      });
    }

    if (toolName === "icp_ii_auth_verify") {
      const challengeToken = typeof args.challengeToken === "string" ? args.challengeToken : "";
      const publicKeyHex = typeof args.publicKeyHex === "string" ? args.publicKeyHex : "";
      const signatureHex = typeof args.signatureHex === "string" ? args.signatureHex : undefined;
      const principal = typeof args.principal === "string" ? args.principal : undefined;
      const algorithm =
        args.algorithm === "ECDSA_P256" || args.algorithm === "ED25519" || args.algorithm === "ICP_DELEGATION"
          ? args.algorithm
          : undefined;

      const verifyRes = await verifyIcpIiChallenge({
        challengeToken,
        publicKeyHex,
        ...(signatureHex ? { signatureHex } : {}),
        ...(principal ? { principal } : {}),
        ...(algorithm ? { algorithm } : {}),
      });

      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          isError: !verifyRes.ok,
          content: [{ type: "text", text: JSON.stringify(verifyRes, null, 2) }],
        },
      });
    }

    if (toolName === "validate_ntrip_server") {
      const parsed = ValidateInputSchema.safeParse(args);
      if (!parsed.success) {
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    compliant: false,
                    error: "INVALID_ARGUMENTS",
                    issues: parsed.error.issues,
                  },
                  null,
                  2
                ),
              },
            ],
          },
        });
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
        ...(d.ntripRevision !== undefined ? { ntripRevision: d.ntripRevision } : {}),
        ...(d.sourcePassword !== undefined ? { sourcePassword: d.sourcePassword } : {}),
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

      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          isError: !report.compliant,
          content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        },
      });
    }

    if (toolName === "create_ntrip_config") {
      const tokenInput =
        (typeof args.icpSessionToken === "string" ? args.icpSessionToken : undefined) ??
        c.req.header("Authorization");
      const authCheck = await verifyIcpSessionToken(tokenInput);
      if (!authCheck.ok) {
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    code: "ICP_II_AUTH_REQUIRED",
                    message: authCheck.error,
                    howToAuthenticate:
                      "Call MCP tool 'icp_ii_auth_challenge' followed by 'icp_ii_auth_verify' to obtain a valid 'icpSessionToken'.",
                  },
                  null,
                  2
                ),
              },
            ],
          },
        });
      }

      const parsed = ValidateInputSchema.safeParse(args);
      if (!parsed.success) {
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    code: "INVALID_CONFIG_SCHEMA",
                    issues: parsed.error.issues,
                  },
                  null,
                  2
                ),
              },
            ],
          },
        });
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
        ...(d.ntripRevision !== undefined ? { ntripRevision: d.ntripRevision } : {}),
        ...(d.sourcePassword !== undefined ? { sourcePassword: d.sourcePassword } : {}),
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
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    code: "NTRIP_SPEC_VALIDATION_FAILED",
                    message:
                      "Candidate NTRIP configuration failed RTCM 10410.0 / 10410.1 / 10403.3 specification checks and was rejected.",
                    validationReport: report,
                  },
                  null,
                  2
                ),
              },
            ],
          },
        });
      }

      const registered = registerValidatedConfig(authCheck.claims.principal, report);
      const mp = registered.station.mountpoint;
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          isError: false,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  configId: registered.configId,
                  ownerPrincipal: registered.ownerPrincipal,
                  createdAtIso: registered.createdAtIso,
                  ntripRevision: registered.ntripRevision,
                  mountpoint: mp,
                  endpoints: {
                    ntripAutoStreamUrl: `https://ntrip.ai-kit.net/${mp}`,
                    rev1StreamUrl:
                      registered.ntripRevision === "rev1" || registered.ntripRevision === "dual"
                        ? `https://ntrip.ai-kit.net/rev1/${mp}`
                        : null,
                    rev2StreamUrl:
                      registered.ntripRevision === "rev2" || registered.ntripRevision === "dual"
                        ? `https://ntrip.ai-kit.net/rev2/${mp}`
                        : null,
                    simulateEpochUrl: `https://ntrip.ai-kit.net/api/v1/simulate/epoch?mountpoint=${mp}`,
                    sseStreamUrl: `https://ntrip.ai-kit.net/api/v1/stream/${mp}`,
                  },
                  strRecordLine: registered.strRecordLine,
                  validationReport: registered.validationReport,
                },
                null,
                2
              ),
            },
          ],
        },
      });
    }

    if (toolName === "compare_ntrip_revisions") {
      const mountpoint = typeof args.mountpoint === "string" ? args.mountpoint : "HAN0-VN";
      const sourcePassword = typeof args.sourcePassword === "string" ? args.sourcePassword : "ntrip123";
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  mountpoint: mountpoint.toUpperCase(),
                  rev1: buildNtripWireTranscript("rev1", { mountpoint, sourcePassword }),
                  rev2: buildNtripWireTranscript("rev2", { mountpoint, sourcePassword }),
                },
                null,
                2
              ),
            },
          ],
        },
      });
    }

    if (toolName === "simulate_rtk_epoch") {
      const mountpoint = typeof args.mountpoint === "string" ? args.mountpoint : "HAN0-VN";
      const epochIndex = typeof args.epochIndex === "number" ? args.epochIndex : 4;
      const epoch = simulateGnssEpoch({ mountpoint, epochIndex, includeExtension4072: true });
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(epoch, null, 2) }],
        },
      });
    }

    if (toolName === "decode_rtcm3_stream") {
      const hexPayload = typeof args.hexPayload === "string" ? args.hexPayload : "";
      const bytes = hexToBytes(hexPayload);
      if (!bytes) {
        return c.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: "Invalid hexadecimal RTCM 3.x payload" }],
          },
        });
      }
      const frames = decodeRtcm3Stream(bytes);
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ frameCount: frames.length, frames }, null, 2) }],
        },
      });
    }

    return c.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown MCP tool '${toolName}'` },
    });
  }

  return c.json({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method '${rpc.method}' not found` },
  });
});

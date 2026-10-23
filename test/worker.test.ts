import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { bytesToHex, decodeRtcm3Stream, validateIcpPrincipal } from "../src/protocol";

describe("NTRIP Edge Worker HTTP & Caster endpoints", () => {
  it("returns JSON health document on GET /health and GET / for API clients", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; protocol: string; mountpoints: unknown[] };
    expect(body.status).toBe("healthy");
    expect(body.protocol).toContain("NTRIP/2.0");
    expect(body.mountpoints.length).toBeGreaterThanOrEqual(6);
  });

  it("serves agent instructions on both GET /llm.txt and GET /llms.txt", async () => {
    const r1 = await app.request("/llm.txt");
    expect(r1.status).toBe(200);
    const t1 = await r1.text();
    expect(t1).toContain("ICP Internet Identity");
    expect(t1).toContain("create_ntrip_config");

    const r2 = await app.request("/llms.txt");
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe(t1);
  });

  it("renders interactive HTML Playground with CSP nonce when Accept includes text/html", async () => {
    const res = await app.request("/", {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("script-src 'nonce-");
    const html = await res.text();
    expect(html).toContain("AI Kit NTRIP Edge");
    expect(html).toContain("Proactive NTRIP Config Builder");
    expect(html).toContain("HAN0-VN");
  });

  it("serves authentic gnss/sourcetable on GET /sourcetable and GET / with Ntrip-Version header", async () => {
    const res = await app.request("/", {
      headers: { "Ntrip-Version": "Ntrip/2.0" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("gnss/sourcetable");
    expect(res.headers.get("Ntrip-Version")).toBe("Ntrip/2.0");
    const text = await res.text();
    expect(text).toContain("STR;HAN0-VN;");
    expect(text).toContain("STR;VRS-AUTO;");
    expect(text).toContain("ENDSOURCETABLE");
  });

  it("streams binary RTCM 3.x packets on GET /HAN0-VN and verifies every frame CRC-24Q", async () => {
    const res = await app.request("/HAN0-VN?epochs=2", {
      headers: { "Ntrip-Version": "Ntrip/2.0" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("gnss/data");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(200);

    const frames = decodeRtcm3Stream(buf);
    expect(frames.length).toBeGreaterThanOrEqual(14);
    expect(frames.every((f) => f.crcValid)).toBe(true);
  });

  it("supports NTRIP v2.0 Server ingest verification on POST /HAN0-VN", async () => {
    const streamRes = await app.request("/HAN0-VN?epochs=1");
    const binaryPayload = await streamRes.arrayBuffer();

    const ingestRes = await app.request("/HAN0-VN", {
      method: "POST",
      body: binaryPayload,
    });
    expect(ingestRes.status).toBe(200);
    const data = (await ingestRes.json()) as { allCrcValid: boolean; frameCount: number };
    expect(data.allCrcValid).toBe(true);
    expect(data.frameCount).toBe(7);
  });

  it("encodes and decodes custom RTCM 3.x frames via /api/v1/rtcm/encode and /api/v1/rtcm/decode", async () => {
    const encRes = await app.request("/api/v1/rtcm/encode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageNumber: 1005,
        stationId: 1088,
        latDeg: 10.776889,
        lonDeg: 106.700806,
        heightM: 19.2,
      }),
    });
    expect(encRes.status).toBe(200);
    const encJson = (await encRes.json()) as { rawHex: string };
    expect(encJson.rawHex.startsWith("D3")).toBe(true);

    const decRes = await app.request("/api/v1/rtcm/decode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: encJson.rawHex, encoding: "hex" }),
    });
    expect(decRes.status).toBe(200);
    const decJson = (await decRes.json()) as { allCrcValid: boolean; frameCount: number };
    expect(decJson.allCrcValid).toBe(true);
    expect(decJson.frameCount).toBe(1);
  });

  it("streams real-time SSE epochs on GET /api/v1/stream/VRS-AUTO", async () => {
    const res = await app.request("/api/v1/stream/VRS-AUTO?epochs=2&intervalMs=0");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: epoch");
    expect(text).toContain("event: complete");
  });

  it("enforces ICP Internet Identity (II) login and NTRIP spec validation on POST /api/v1/configs and /mcp", async () => {
    // 1. Rejects anonymous ICP Principal (2vxsx-fae)
    expect(validateIcpPrincipal("2vxsx-fae", false).valid).toBe(false);

    // 2. Rejects POST /api/v1/configs without ICP II token (401)
    const unauthRes = await app.request("/api/v1/configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mountpoint: "DANANG-VN",
        stationId: 1008,
        identifier: "Da Nang Coastal CORS",
        city: "Da Nang",
        country: "VNM",
        latDeg: 16.054407,
        lonDeg: 108.202167,
        heightM: 15.6,
      }),
    });
    expect(unauthRes.status).toBe(401);

    // 3. Perform WebCrypto ECDSA P-256 ICP II Challenge-Sign authentication
    const chRes = await app.request("/api/v1/auth/icp-ii/challenge");
    expect(chRes.status).toBe(200);
    const chData = (await chRes.json()) as {
      challenge: { challengeToken: string; challengeMessage: string };
    };

    const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const spkiBuf = (await crypto.subtle.exportKey("spki", keyPair.publicKey)) as ArrayBuffer;
    const pubKeyHex = bytesToHex(new Uint8Array(spkiBuf));
    const sigBuf = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      new TextEncoder().encode(chData.challenge.challengeMessage)
    );
    const sigHex = bytesToHex(new Uint8Array(sigBuf));

    const verRes = await app.request("/api/v1/auth/icp-ii/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeToken: chData.challenge.challengeToken,
        publicKeyHex: pubKeyHex,
        signatureHex: sigHex,
        algorithm: "ECDSA_P256",
      }),
    });
    expect(verRes.status).toBe(200);
    const verData = (await verRes.json()) as {
      success: boolean;
      sessionToken: string;
      claims: { principal: string };
    };
    expect(verData.success).toBe(true);
    expect(verData.sessionToken.startsWith("icp_ii_")).toBe(true);
    expect(validateIcpPrincipal(verData.claims.principal, false).valid).toBe(true);

    // 4. Rejects invalid NTRIP config even when authenticated (missing ARP 1005/1006 in formatDetails)
    const invalidSpecRes = await app.request("/api/v1/configs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${verData.sessionToken}`,
      },
      body: JSON.stringify({
        mountpoint: "BAD-CFG",
        stationId: 1008,
        identifier: "Missing ARP Schedule",
        city: "Da Nang",
        country: "VNM",
        latDeg: 16.054407,
        lonDeg: 108.202167,
        heightM: 15.6,
        formatDetails: "1077(1),1087(1)", // Missing 1005/1006 ARP!
      }),
    });
    expect(invalidSpecRes.status).toBe(422);

    // 5. Creates valid NTRIP config via MCP JSON-RPC 2.0 tool `create_ntrip_config`
    const mcpCreateRes = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: {
          name: "create_ntrip_config",
          arguments: {
            icpSessionToken: verData.sessionToken,
            mountpoint: "DANANG-VN",
            stationId: 1008,
            identifier: "Da Nang Coastal CORS Base",
            city: "Da Nang",
            country: "VNM",
            latDeg: 16.054407,
            lonDeg: 108.202167,
            heightM: 15.6,
            formatDetails: "1005(5),1033(10),1077(1),1087(1),1097(1),1127(1),1230(5)",
          },
        },
      }),
    });
    expect(mcpCreateRes.status).toBe(200);
    const mcpJson = (await mcpCreateRes.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(mcpJson.result.isError).toBe(false);
    const createdPayload = JSON.parse(mcpJson.result.content[0]?.text ?? "{}") as {
      success: boolean;
      mountpoint: string;
      ownerPrincipal: string;
      strRecordLine: string;
    };
    expect(createdPayload.success).toBe(true);
    expect(createdPayload.mountpoint).toBe("DANANG-VN");
    expect(createdPayload.ownerPrincipal).toBe(verData.claims.principal);
    expect(createdPayload.strRecordLine).toContain("STR;DANANG-VN;");

    // 6. Verify that the newly registered mountpoint DANANG-VN is immediately live on GET /DANANG-VN and /sourcetable
    const customStreamRes = await app.request("/DANANG-VN?epochs=1");
    expect(customStreamRes.status).toBe(200);
    expect(customStreamRes.headers.get("Content-Type")).toBe("gnss/data");
    const customFrames = decodeRtcm3Stream(new Uint8Array(await customStreamRes.arrayBuffer()));
    expect(customFrames.length).toBeGreaterThanOrEqual(7);
    expect(customFrames.every((f) => f.crcValid)).toBe(true);

    const stRes = await app.request("/sourcetable");
    expect(await stRes.text()).toContain("STR;DANANG-VN;");

    // 7. Distinct NTRIP Rev 1 (v1.0) vs Rev 2 (v2.0) server behavior & strict revision enforcement
    const rev1StRes = await app.request("/rev1/sourcetable?wire=true");
    expect(rev1StRes.status).toBe(200);
    expect(rev1StRes.headers.get("X-Ntrip-Revision")).toBe("rev1");
    expect(rev1StRes.headers.get("X-Ntrip-Status-Line")).toBe("SOURCETABLE 200 OK");
    expect(rev1StRes.headers.get("Ntrip-Version")).toBeNull();
    expect(await rev1StRes.text()).toContain("SOURCETABLE 200 OK\r\n");

    const rev2StRes = await app.request("/rev2/sourcetable");
    expect(rev2StRes.status).toBe(200);
    expect(rev2StRes.headers.get("X-Ntrip-Revision")).toBe("rev2");
    expect(rev2StRes.headers.get("Ntrip-Version")).toBe("Ntrip/2.0");
    expect(rev2StRes.headers.get("Content-Type")).toContain("gnss/sourcetable");

    // Create a strict Rev 1-only station (HUE-REV1) and a strict Rev 2-only station (HUE-REV2)
    const createRev1Res = await app.request("/api/v1/configs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${verData.sessionToken}`,
      },
      body: JSON.stringify({
        mountpoint: "HUE-REV1",
        stationId: 1009,
        identifier: "Hue Legacy Rev1 Base",
        city: "Hue",
        country: "VNM",
        latDeg: 16.463713,
        lonDeg: 107.590866,
        heightM: 12.4,
        ntripRevision: "rev1",
        sourcePassword: "huePassword1",
      }),
    });
    expect(createRev1Res.status).toBe(201);

    // HUE-REV1 succeeds on /rev1/HUE-REV1 and rejects /rev2/HUE-REV1 with 400 NTRIP_REVISION_MISMATCH
    const hueRev1Ok = await app.request("/rev1/HUE-REV1?epochs=1");
    expect(hueRev1Ok.status).toBe(200);
    expect(hueRev1Ok.headers.get("X-Ntrip-Revision")).toBe("rev1");
    expect(hueRev1Ok.headers.get("X-Ntrip-Status-Line")).toBe("ICY 200 OK");

    const hueRev1RejectedOnRev2 = await app.request("/rev2/HUE-REV1?epochs=1");
    expect(hueRev1RejectedOnRev2.status).toBe(400);

    // Test Rev 1 SOURCE <password> /<mountpoint> Server Ingest
    const sampleRtcmBytes = new Uint8Array(await hueRev1Ok.arrayBuffer());
    const sourceHeaderBytes = new TextEncoder().encode(
      "SOURCE huePassword1 /HUE-REV1\r\nSource-Agent: NTRIP LegacyBase/1.0\r\n\r\n"
    );
    const rev1IngestBuf = new Uint8Array(sourceHeaderBytes.length + sampleRtcmBytes.length);
    rev1IngestBuf.set(sourceHeaderBytes, 0);
    rev1IngestBuf.set(sampleRtcmBytes, sourceHeaderBytes.length);

    const rev1IngestRes = await app.request("/rev1/HUE-REV1", {
      method: "POST",
      body: rev1IngestBuf,
    });
    expect(rev1IngestRes.status).toBe(200);
    const rev1IngestJson = (await rev1IngestRes.json()) as {
      revision: string;
      casterResponseStatusLine: string;
      allCrcValid: boolean;
      rev1SourceHeader: { password?: string; mountpoint?: string };
    };
    expect(rev1IngestJson.revision).toBe("rev1");
    expect(rev1IngestJson.casterResponseStatusLine).toBe("ICY 200 OK");
    expect(rev1IngestJson.allCrcValid).toBe(true);
    expect(rev1IngestJson.rev1SourceHeader.mountpoint).toBe("HUE-REV1");
  });
});

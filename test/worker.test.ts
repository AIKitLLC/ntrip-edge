import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { decodeRtcm3Stream } from "../src/protocol";

describe("NTRIP Edge Worker HTTP & Caster endpoints", () => {
  it("returns JSON health document on GET /health and GET / for API clients", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; protocol: string; mountpoints: unknown[] };
    expect(body.status).toBe("healthy");
    expect(body.protocol).toContain("NTRIP/2.0");
    expect(body.mountpoints.length).toBeGreaterThanOrEqual(6);
  });

  it("renders interactive HTML Playground with CSP nonce when Accept includes text/html", async () => {
    const res = await app.request("/", {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("script-src 'nonce-");
    const html = await res.text();
    expect(html).toContain("AI Kit NTRIP Edge");
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
});

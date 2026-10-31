import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as http from "node:http";
import * as https from "node:https";

const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function isBlockedIPv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) {
    return true;
  }
  const value =
    ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>>
    0;
  const ranges: Array<[number, number]> = [
    [0x00000000, 8], // Current network
    [0x0a000000, 8], // Private
    [0x64400000, 10], // Shared address space
    [0x7f000000, 8], // Loopback
    [0xa9fe0000, 16], // Link local
    [0xac100000, 12], // Private
    [0xc0000000, 24], // IETF protocol assignments
    [0xc0000200, 24], // Documentation
    [0xc0586300, 24], // Deprecated 6to4 relay anycast
    [0xc0a80000, 16], // Private
    [0xc6120000, 15], // Benchmarking
    [0xc6336400, 24], // Documentation
    [0xcb007100, 24], // Documentation
    [0xe0000000, 4], // Multicast and reserved
  ];

  return ranges.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return ((value & mask) >>> 0) === network;
  });
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !isBlockedIPv4(address);
  if (version !== 6) return false;

  // Only accept globally routable IPv6 unicast addresses. This also excludes
  // loopback, unique-local, link-local, IPv4-mapped and unspecified addresses.
  const firstSegment = Number.parseInt(address.split(":")[0] || "0", 16);
  if (firstSegment < 0x2000 || firstSegment > 0x3fff) return false;
  const segments = address.toLowerCase().split(":");
  const secondSegment = Number.parseInt(segments[1] || "0", 16);
  if (firstSegment === 0x2001 && secondSegment <= 0x01ff) return false;
  if (firstSegment === 0x2001 && secondSegment === 0x0db8) return false;
  if (firstSegment === 0x2002) return false; // 6to4 can tunnel to private IPv4 ranges.
  return true;
}

async function resolvePublicAddress(hostname: string) {
  const unwrappedHostname = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  const normalizedHostname = unwrappedHostname.toLowerCase().replace(/\.$/, "");
  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname.endsWith(".local")
  ) {
    throw new Error("The endpoint host must resolve only to public IP addresses.");
  }
  const literalFamily = isIP(unwrappedHostname);
  const addresses = literalFamily
    ? [{ address: unwrappedHostname, family: literalFamily }]
    : await lookup(unwrappedHostname, { all: true, verbatim: true });

  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error("The endpoint host must resolve only to public IP addresses.");
  }
  return addresses[0];
}

async function forwardRequest(
  target: URL,
  body: string,
  payment?: string,
): Promise<{ status: number; statusText: string; body: string; receipt: string | null }> {
  const pinnedAddress = await resolvePublicAddress(target.hostname);
  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(payment ? { "X-PAYMENT": payment } : {}),
          "Content-Length": Buffer.byteLength(body),
          Connection: "close",
        },
        agent: false,
        lookup: (_hostname, _options, callback) => {
          callback(null, pinnedAddress.address, pinnedAddress.family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let byteCount = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteCount += buffer.length;
          if (byteCount > MAX_BODY_BYTES) {
            request.destroy(new Error("The endpoint response exceeds the 1 MB limit."));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 502,
            statusText: response.statusMessage ?? "",
            body: Buffer.concat(chunks).toString("utf8"),
            receipt: response.headers["x-payment-response"]?.toString() ?? null,
          });
        });
        response.on("error", reject);
      },
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("The endpoint request timed out after 15 seconds."));
    });
    request.on("error", reject);
    request.end(body);
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    const requestHost = request.headers.get("host");
    let originHost = "";
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:") {
        originHost = parsedOrigin.host;
      }
    } catch {
      // Reject malformed Origin headers below.
    }
    if (!requestHost || originHost.toLowerCase() !== requestHost.toLowerCase()) {
      return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
    }
  }

  let input: Record<string, unknown>;
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 64 * 1024) {
      return Response.json({ error: "Request body exceeds the 64 KB limit." }, { status: 413 });
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 64 * 1024) {
      return Response.json({ error: "Request body exceeds the 64 KB limit." }, { status: 413 });
    }
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof input.endpoint !== "string" || typeof input.prompt !== "string") {
    return Response.json({ error: "Endpoint and prompt are required." }, { status: 400 });
  }
  if (input.prompt.length > 20_000) {
    return Response.json({ error: "Prompt must be 20,000 characters or fewer." }, { status: 400 });
  }
  if (input.payment !== undefined && typeof input.payment !== "string") {
    return Response.json({ error: "Payment must be a string." }, { status: 400 });
  }
  if (typeof input.payment === "string" && input.payment.length > 8 * 1024) {
    return Response.json({ error: "Payment must be 8 KB or fewer." }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(input.endpoint);
  } catch {
    return Response.json({ error: "Enter a valid service endpoint URL." }, { status: 400 });
  }
  if (
    (target.protocol !== "https:" && target.protocol !== "http:") ||
    target.username ||
    target.password
  ) {
    return Response.json(
      { error: "Endpoint must be an HTTP(S) URL without embedded credentials." },
      { status: 400 },
    );
  }

  try {
    const result = await forwardRequest(
      target,
      JSON.stringify({ prompt: input.prompt }),
      input.payment?.trim() || undefined,
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach the endpoint.";
    return Response.json({ error: message }, { status: 502 });
  }
}

const CACHE_KEY = 'dbmerge_hwid';
const AGENT_URL = 'http://127.0.0.1:7799/hwid';
const AGENT_TIMEOUT_MS = 800;

// ── 하드웨어 핑거프린트 폴백 ──────────────────────────────────

function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(100, 1, 80, 40);
    ctx.fillStyle = '#069';
    ctx.font = '14px Arial';
    ctx.fillText('dbmerge☃', 2, 30);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.font = '16px Georgia';
    ctx.fillText('dbmerge☃', 4, 45);
    return canvas.toDataURL();
  } catch {
    return '';
  }
}

function getWebGLInfo(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return '';
    return [
      gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
      gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
    ].join('|');
  } catch {
    return '';
  }
}

async function sha256hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

async function generateFingerprint(): Promise<string> {
  const signals = [
    navigator.hardwareConcurrency ?? 0,
    (navigator as { deviceMemory?: number }).deviceMemory ?? 0,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.platform,
    getWebGLInfo(),
    getCanvasFingerprint(),
  ].join('||');
  return sha256hex(signals);
}

// ── HWID 에이전트 시도 ────────────────────────────────────────

async function fetchAgentHwid(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
    const res = await fetch(AGENT_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json.hwid === 'string' && json.hwid ? json.hwid : null;
  } catch {
    return null;
  }
}

// ── 공개 API ─────────────────────────────────────────────────

let _promise: Promise<string> | null = null;

/**
 * 기기 고유 ID.
 * 1순위: hwid-agent (CPU ID 기반, 브라우저 무관)
 * 2순위: 하드웨어 핑거프린트 (GPU + CPU cores + 시간대 등)
 */
export function getMachineId(): Promise<string> {
  if (typeof window === 'undefined') return Promise.resolve('');
  if (_promise) return _promise;

  _promise = (async () => {
    // 캐시 확인 (구 UUID 형식은 재생성)
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached && !/^[0-9a-f-]{36}$/.test(cached)) return cached;

    // 1순위: hwid-agent
    const agentId = await fetchAgentHwid();
    if (agentId) {
      localStorage.setItem(CACHE_KEY, agentId);
      return agentId;
    }

    // 2순위: 하드웨어 핑거프린트
    const fp = await generateFingerprint();
    localStorage.setItem(CACHE_KEY, fp);
    return fp;
  })();

  return _promise;
}

/** 에이전트가 실행 중인지 확인 */
export async function isAgentRunning(): Promise<boolean> {
  return (await fetchAgentHwid()) !== null;
}

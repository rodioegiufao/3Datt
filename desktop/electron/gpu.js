"use strict";
// Tudo o que faz o Chromium/Electron usar a placa de vídeo no máximo.
// Precisa rodar ANTES de app.whenReady() (as chaves de linha de comando só valem na inicialização).

const os = require("node:os");
const { execFile } = require("node:child_process");

// Perfis de qualidade. Os valores de escala são relativos ao tamanho do canvas na tela
// (1 = pixel nativo do Windows sem zoom; 2 = supersampling 2x).
const QUALITY_PRESETS = Object.freeze({
    max: {
        label: "Máxima",
        msaa: 8,                 // antialias de hardware 8x (o Chromium limita ao máximo suportado pela placa)
        restScaleMin: 1.5,       // parado: supersampling 1,5x mesmo em monitor 100%
        restScaleMax: 2,
        navFloor: 0.6,           // navegando: resolução dinâmica nunca abaixo de 60% do repouso
        hideEdgesWhileMoving: false,
        hideSAOWhileMoving: false,
        saoSamples: 20,
        targetFrameMs: 1000 / 60
    },
    balanced: {
        label: "Equilibrada",
        msaa: 4,
        restScaleMin: 1,
        restScaleMax: 1.5,
        navFloor: 0.5,
        hideEdgesWhileMoving: false,
        hideSAOWhileMoving: true,
        saoSamples: 12,
        targetFrameMs: 1000 / 60
    },
    performance: {
        label: "Desempenho",
        msaa: 2,
        restScaleMin: 1,
        restScaleMax: 1,
        navFloor: 0.4,
        hideEdgesWhileMoving: true,
        hideSAOWhileMoving: true,
        saoSamples: 8,
        targetFrameMs: 1000 / 60
    }
});

function presetFor(quality) {
    return QUALITY_PRESETS[quality] || QUALITY_PRESETS.max;
}

// Heap do JavaScript da página 3D. O Electron usa "pointer compression" no V8, o que limita
// cada processo a 4 GB de heap; a geometria (ArrayBuffers/GPU) fica fora desse limite.
function rendererHeapMb() {
    const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
    return Math.max(2048, Math.min(4096, Math.floor(totalMb * 0.5)));
}

function applyGpuSwitches(app, prefs) {
    const cl = app.commandLine;
    const preset = presetFor(prefs.get("quality"));
    const safeMode = process.argv.includes("--safe-mode");

    if (safeMode) {
        // Modo de segurança: para drivers problemáticos (abre com OpenGL do ANGLE, sem forçar nada)
        cl.appendSwitch("use-angle", "gl");
        cl.appendSwitch("ignore-gpu-blocklist");
        return { safeMode, preset };
    }

    // 1) GPU dedicada em notebooks híbridos (Intel/AMD integrada + NVIDIA/AMD dedicada)
    if (prefs.get("forceDedicatedGpu")) cl.appendSwitch("force_high_performance_gpu");

    // 2) Nunca cair em renderização por software por causa de driver "em lista negra"
    cl.appendSwitch("ignore-gpu-blocklist");
    cl.appendSwitch("enable-gpu-rasterization");
    cl.appendSwitch("enable-zero-copy");
    cl.appendSwitch("enable-accelerated-video-decode");

    // 3) Não reduzir prioridade/temporizadores quando a janela perde o foco (ex.: ao apresentar)
    cl.appendSwitch("disable-renderer-backgrounding");
    cl.appendSwitch("disable-background-timer-throttling");
    cl.appendSwitch("disable-backgrounding-occluded-windows");

    // 4) Antialias de hardware conforme o perfil
    cl.appendSwitch("webgl-msaa-sample-count", String(preset.msaa));

    // 5) Mais memória para o JavaScript (metadados/propriedades de modelos grandes)
    cl.appendSwitch("js-flags", `--max-old-space-size=${rendererHeapMb()}`);

    // 6) Backend gráfico (Windows: ANGLE sobre Direct3D 11 é o padrão e o mais estável)
    const angle = prefs.get("angle");
    if (angle && angle !== "auto") cl.appendSwitch("use-angle", angle);

    // 7) FPS acima da taxa do monitor (só faz sentido para medir/benchmark; pode causar "tearing")
    if (prefs.get("unlockFps")) {
        cl.appendSwitch("disable-frame-rate-limit");
        cl.appendSwitch("disable-gpu-vsync");
    }

    return { safeMode, preset };
}

// ---------------------------------------------------------------------------------------------
// Windows: preferência de GPU por executável (Configurações > Tela > Gráficos > Alto desempenho)
// O instalador NSIS já grava isso; aqui garantimos também para a versão portátil/execução em dev.
// ---------------------------------------------------------------------------------------------
const GPU_PREF_KEY = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";

function regQuery(exePath) {
    return new Promise((resolve) => {
        execFile("reg", ["query", GPU_PREF_KEY, "/v", exePath], { windowsHide: true }, (error, stdout) => {
            if (error) return resolve(null);
            const match = String(stdout).match(/REG_SZ\s+(.+)\s*$/m);
            resolve(match ? match[1].trim() : null);
        });
    });
}

function regSet(exePath, value) {
    return new Promise((resolve) => {
        execFile("reg", ["add", GPU_PREF_KEY, "/v", exePath, "/t", "REG_SZ", "/d", value, "/f"], { windowsHide: true },
            (error) => resolve(!error));
    });
}

function regDelete(exePath) {
    return new Promise((resolve) => {
        execFile("reg", ["delete", GPU_PREF_KEY, "/v", exePath, "/f"], { windowsHide: true }, (error) => resolve(!error));
    });
}

/** Retorna true se o valor do registro mudou (o efeito só vale no próximo início do processo). */
async function syncWindowsGpuPreference(enabled) {
    if (process.platform !== "win32") return false;
    const exePath = process.execPath;
    const current = await regQuery(exePath);
    if (enabled) {
        if (current && /GpuPreference=2;/.test(current)) return false;
        return regSet(exePath, "GpuPreference=2;");
    }
    if (current) return regDelete(exePath);
    return false;
}

// ---------------------------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------------------------
const VENDORS = { 0x10de: "NVIDIA", 0x1002: "AMD", 0x1022: "AMD", 0x8086: "Intel", 0x1414: "Microsoft (software)", 0x15ad: "VMware", 0x106b: "Apple", 0x5143: "Qualcomm" };
const DISCRETE_VENDORS = new Set([0x10de, 0x1002]);

function describeGpuInfo(info) {
    const devices = Array.isArray(info?.gpuDevice) ? info.gpuDevice : [];
    const list = devices.map((d) => ({
        vendor: VENDORS[d.vendorId] || `0x${Number(d.vendorId || 0).toString(16)}`,
        vendorId: d.vendorId,
        deviceId: d.deviceId,
        active: Boolean(d.active),
        driver: d.driverVersion || "",
        name: d.deviceString || ""
    }));
    const active = list.find((d) => d.active) || list[0] || null;
    const hasDiscrete = list.some((d) => DISCRETE_VENDORS.has(d.vendorId));
    const activeIsDiscrete = active ? DISCRETE_VENDORS.has(active.vendorId) : false;
    return { devices: list, active, hasDiscrete, activeIsDiscrete };
}

function isSoftwareRenderer(rendererString = "") {
    return /swiftshader|basic render|llvmpipe|software|microsoft basic/i.test(rendererString);
}

module.exports = {
    QUALITY_PRESETS,
    presetFor,
    applyGpuSwitches,
    rendererHeapMb,
    syncWindowsGpuPreference,
    describeGpuInfo,
    isSoftwareRenderer
};

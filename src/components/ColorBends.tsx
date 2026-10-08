'use client'

/**
 * ColorBends — 动态斜向光带背景。
 * 源码来自 React Bits（MIT，github.com/DavidHDev/react-bits），按本项目需要
 * 转成 TypeScript 并收紧了类型；着色器逻辑与上游一致。
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import './ColorBends.css'

const MAX_COLORS = 8

/** 拖尾：指针走过的地方注入一团会指数衰减的亮斑，机制抄对标那套 splat + densityDissipation，
 *  但不引第二套引擎——十个点以内直接在现有那一个 pass 里按高斯叠。 */
const TRAIL_POINTS = 10
/** 相邻两枚点的最小间距（NDC，0.03 ≈ 22px）：慢速移动时不让点挤成一坨。 */
const TRAIL_MIN_STEP = 0.03
/** NDC 半径（横向 1 = 半屏宽），0.15 ≈ 108px：够看清"光跟着手走"，又不会糊成一片。 */
const TRAIL_RADIUS = 0.15
/** 亮度衰减到 1/e 的秒数；判据在指针归位后 600ms 取样。 */
const TRAIL_TAU = 0.9
/** 拖尾是加在合成结果之后的**附加光**，所以这一档和"画面上亮多少"是线性的：0.16 实测峰值加约 22 个
 *  通道亮度单位。之前那个 1.4 是配着"抬 alpha"的旧合成写的，换成附加光后会顶满成一枚大白点。
 *  另外真实鼠标一秒推上百个点，全靠着色器那句 1-exp(-Σ) 软饱和压住，否则光标那一点直接饱和。 */
const TRAIL_STRENGTH = 0.16

const frag = `
#define MAX_COLORS ${MAX_COLORS}
uniform vec2 uCanvas;
uniform float uTime;
uniform float uSpeed;
uniform vec2 uRot;
uniform int uColorCount;
uniform vec3 uColors[MAX_COLORS];
uniform int uTransparent;
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2 uPointer; // in NDC [-1,1]
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uNoise;
uniform int uIterations;
uniform float uIntensity;
uniform float uBandWidth;
uniform vec4 uTrail[${TRAIL_POINTS}]; // xy = NDC 位置，z = 这一团还剩多亮
uniform float uTrailRadius;
uniform vec3 uTrailColor;
varying vec2 vUv;

void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  vec2 q = vec2(rp.x * (uCanvas.x / uCanvas.y), rp.y);
  q /= max(uScale, 0.0001);
  q /= 0.5 + 0.2 * dot(q, q);
  q += 0.2 * cos(t) - 7.56;
  vec2 toward = (uPointer - rp);
  q += toward * uMouseInfluence * 0.2;

    for (int j = 0; j < 5; j++) {
      if (j >= uIterations - 1) break;
      vec2 rr = sin(1.5 * (q.yx * uFrequency) + 2.0 * cos(q * uFrequency));
      q += (rr - q) * 0.15;
    }

    vec3 col = vec3(0.0);
    float a = 1.0;
    if (uColorCount > 0) {
      vec2 s = q;
      vec3 sumCol = vec3(0.0);
      float cover = 0.0;
      for (int i = 0; i < MAX_COLORS; ++i) {
            if (i >= uColorCount) break;
            s -= 0.01;
            vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
            float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
            float kBelow = clamp(uWarpStrength, 0.0, 1.0);
            float kMix = pow(kBelow, 0.3);
            float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
            vec2 disp = (r - s) * kBelow;
            vec2 warped = s + disp * gain;
            float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
            float m = mix(m0, m1, kMix);
            float w = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
            sumCol += uColors[i] * w;
            cover = max(cover, w);
      }
      col = clamp(sumCol, 0.0, 1.0);
      a = uTransparent > 0 ? cover : 1.0;
    } else {
        vec2 s = q;
        for (int k = 0; k < 3; ++k) {
            s -= 0.01;
            vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
            float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(k)) / 4.0);
            float kBelow = clamp(uWarpStrength, 0.0, 1.0);
            float kMix = pow(kBelow, 0.3);
            float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
            vec2 disp = (r - s) * kBelow;
            vec2 warped = s + disp * gain;
            float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(k)) / 4.0);
            float m = mix(m0, m1, kMix);
            col[k] = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
        }
        a = uTransparent > 0 ? max(max(col.r, col.g), col.b) : 1.0;
    }

    col *= uIntensity;

    // 拖尾：指针划过留一团会指数衰减的亮斑。坐标用未旋转的屏幕空间，所以尾迹钉在划过的位置上、
    // 不跟着条带漂；它作为**附加光**加在合成结果之后，不再被条带自己那道 alpha(≈0.25) 乘一遍，
    // 所以 strength 与"画面上亮多少"是线性的、可直接算。
    float glow = 0.0;
    vec2 tp = vUv * 2.0 - 1.0;
    tp.x *= uCanvas.x / uCanvas.y;
    for (int i = 0; i < ${TRAIL_POINTS}; i++) {
      float k = uTrail[i].z;
      if (k <= 0.0) continue;
      vec2 c = uTrail[i].xy;
      c.x *= uCanvas.x / uCanvas.y;
      float d = length(tp - c) / uTrailRadius;
      glow += k * exp(-d * d);
    }
    // 软饱和：真实鼠标一秒能推上百个点，硬 min() 会让光标那一点直接顶满＝一枚大白点。
    glow = (1.0 - exp(-glow)) * ${TRAIL_STRENGTH.toFixed(2)};

    if (uNoise > 0.0001) {
      float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
      col += (n - 0.5) * uNoise;
      col = clamp(col, 0.0, 1.0);
    }

    vec3 rgb = (uTransparent > 0) ? col * a : col;
    gl_FragColor = vec4(rgb + uTrailColor * glow, a);
}
`

const vert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`

export interface ColorBendsProps {
  className?: string
  style?: React.CSSProperties
  rotation?: number
  speed?: number
  colors?: string[]
  transparent?: boolean
  autoRotate?: number
  scale?: number
  frequency?: number
  warpStrength?: number
  mouseInfluence?: number
  parallax?: number
  noise?: number
  iterations?: number
  intensity?: number
  bandWidth?: number
  /** 打开后指针划过画布会留下一条指数衰减的亮尾。 */
  trail?: boolean
}

export default function ColorBends({
  className,
  style,
  rotation = 90,
  speed = 0.2,
  colors = [],
  transparent = true,
  autoRotate = 0,
  scale = 1,
  frequency = 1,
  warpStrength = 1,
  mouseInfluence = 1,
  parallax = 0.5,
  noise = 0.15,
  iterations = 1,
  intensity = 1.5,
  bandWidth = 6,
  trail = false,
}: ColorBendsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const rafRef = useRef<number | null>(null)
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const rotationRef = useRef(rotation)
  const autoRotateRef = useRef(autoRotate)
  const pointerTargetRef = useRef(new THREE.Vector2(0, 0))
  const pointerCurrentRef = useRef(new THREE.Vector2(0, 0))
  const pointerSmoothRef = useRef(8)
  // 拖尾：最近 TRAIL_POINTS 个指针采样点，各自带落点时刻，亮度按 TRAIL_TAU 指数衰减。
  const trailRef = useRef<{ x: number; y: number; t: number }[]>([])
  // 系统要求减少动效：这一层只画一帧，不排下一帧，也不跟指针走。
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const geometry = new THREE.PlaneGeometry(2, 2)
    const uColorsArray = Array.from({ length: MAX_COLORS }, () => new THREE.Vector3(0, 0, 0))
    const material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uCanvas: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uSpeed: { value: speed },
        uRot: { value: new THREE.Vector2(1, 0) },
        uColorCount: { value: 0 },
        uColors: { value: uColorsArray },
        uTransparent: { value: transparent ? 1 : 0 },
        uScale: { value: scale },
        uFrequency: { value: frequency },
        uWarpStrength: { value: warpStrength },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uMouseInfluence: { value: mouseInfluence },
        uParallax: { value: parallax },
        uNoise: { value: noise },
        uIterations: { value: iterations },
        uIntensity: { value: intensity },
        uBandWidth: { value: bandWidth },
        uTrail: { value: Array.from({ length: TRAIL_POINTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
        uTrailRadius: { value: TRAIL_RADIUS },
        uTrailColor: { value: new THREE.Vector3(0.55, 0.5, 1.0) },
      },
      premultipliedAlpha: true,
      transparent: true,
    })
    materialRef.current = material

    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const renderer = (() => {
      try {
        return new THREE.WebGLRenderer({
          antialias: false,
          powerPreference: 'high-performance',
          alpha: true,
        })
      } catch {
        // 纯装饰层：没有 WebGL 的环境（无头截图、显卡被拉黑）不能把整页带崩。
        return null
      }
    })()
    if (!renderer) {
      materialRef.current = null
      geometry.dispose()
      material.dispose()
      return
    }
    rendererRef.current = renderer
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, transparent ? 0 : 1)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    container.appendChild(renderer.domElement)

    const clock = new THREE.Clock()

    const handleResize = () => {
      const w = container.clientWidth || 1
      const h = container.clientHeight || 1
      renderer.setSize(w, h, false)
      material.uniforms.uCanvas.value.set(w, h)
    }

    handleResize()

    const ro = new ResizeObserver(handleResize)
    ro.observe(container)
    resizeObserverRef.current = ro

    const loop = () => {
      const dt = clock.getDelta()
      const elapsed = clock.elapsedTime
      material.uniforms.uTime.value = elapsed

      const deg = (rotationRef.current % 360) + autoRotateRef.current * elapsed
      const rad = (deg * Math.PI) / 180
      const c = Math.cos(rad)
      const s = Math.sin(rad)
      material.uniforms.uRot.value.set(c, s)

      const cur = pointerCurrentRef.current
      const tgt = pointerTargetRef.current
      const amt = Math.min(1, dt * pointerSmoothRef.current)
      cur.lerp(tgt, amt)
      material.uniforms.uPointer.value.copy(cur)

      const now = performance.now()
      const trail = material.uniforms.uTrail.value as THREE.Vector4[]
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const p = trailRef.current[i]
        if (!p) trail[i].set(0, 0, 0, 0)
        else trail[i].set(p.x, p.y, Math.exp(-(now - p.t) / 1000 / TRAIL_TAU), 0)
      }

      renderer.render(scene, camera)
      if (!reduced) rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (resizeObserverRef.current) resizeObserverRef.current.disconnect()
      else window.removeEventListener('resize', handleResize)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      if (renderer.domElement && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [
    bandWidth,
    frequency,
    intensity,
    iterations,
    mouseInfluence,
    noise,
    parallax,
    reduced,
    scale,
    speed,
    transparent,
    warpStrength,
  ])

  useEffect(() => {
    const material = materialRef.current
    const renderer = rendererRef.current
    if (!material) return

    rotationRef.current = rotation
    autoRotateRef.current = autoRotate
    material.uniforms.uSpeed.value = speed
    material.uniforms.uScale.value = scale
    material.uniforms.uFrequency.value = frequency
    material.uniforms.uWarpStrength.value = warpStrength
    material.uniforms.uMouseInfluence.value = mouseInfluence
    material.uniforms.uParallax.value = parallax
    material.uniforms.uNoise.value = noise
    material.uniforms.uIterations.value = iterations
    material.uniforms.uIntensity.value = intensity
    material.uniforms.uBandWidth.value = bandWidth

    const toVec3 = (hex: string) => {
      const h = hex.replace('#', '').trim()
      const v =
        h.length === 3
          ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
          : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
      return new THREE.Vector3(v[0] / 255, v[1] / 255, v[2] / 255)
    }

    const arr = (colors || []).filter(Boolean).slice(0, MAX_COLORS).map(toVec3)
    for (let i = 0; i < MAX_COLORS; i++) {
      const vec = material.uniforms.uColors.value[i]
      if (i < arr.length) vec.copy(arr[i])
      else vec.set(0, 0, 0)
    }
    material.uniforms.uColorCount.value = arr.length
    // 拖尾既不跟条带那支 #8f7bff（偏蓝、亮度权重只有 0.53，叠在同色底上等于没叠），也不用近白
    // （(0.85,0.85,1) 那档实测就是一枚大白点）——取一条更亮的紫，读起来是"光"不是"洞"。

    material.uniforms.uTransparent.value = transparent ? 1 : 0
    if (renderer) renderer.setClearColor(0x000000, transparent ? 0 : 1)
  }, [
    rotation,
    autoRotate,
    speed,
    scale,
    frequency,
    warpStrength,
    mouseInfluence,
    parallax,
    noise,
    iterations,
    intensity,
    bandWidth,
    colors,
    transparent,
  ])

  useEffect(() => {
    const material = materialRef.current
    const container = containerRef.current
    if (!material || !container) return
    // 减少动效：这一层根本不跟指针，尾也一枚都不留（H57 量的就是"划过去画布一字节都不变"）。
    if (reduced) {
      trailRef.current = []
      return
    }

    const handlePointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      // 这层压在内容底下、自己不吃指针事件，所以只能听 window；坐标夹回 ±1，
      // 鼠标划出这一屏之外时不许把着色器推到界外（推出去就回不来了）。
      const nx = ((e.clientX - rect.left) / (rect.width || 1)) * 2 - 1
      const ny = -(((e.clientY - rect.top) / (rect.height || 1)) * 2 - 1)
      const x = Math.max(-1, Math.min(1, nx))
      const y = Math.max(-1, Math.min(1, ny))
      pointerTargetRef.current.set(x, y)
      if (!trail) return
      const last = trailRef.current[trailRef.current.length - 1]
      // 真实鼠标一秒能推上百个点，不拉开间距就全堆在光标那一处 —— 那就是他看到的"大白点"。
      if (last && Math.hypot(x - last.x, y - last.y) < TRAIL_MIN_STEP) return
      const now = performance.now()
      // 只留最近 TRAIL_POINTS 枚、且还没衰完的（4τ 后剩不到 2%，留着是占位）。
      const kept = trailRef.current.filter((p) => now - p.t < TRAIL_TAU * 4000)
      kept.push({ x, y, t: now })
      trailRef.current = kept.slice(-TRAIL_POINTS)
    }

    window.addEventListener('pointermove', handlePointerMove)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [reduced, trail])

  return <div ref={containerRef} className={`color-bends-container ${className ?? ''}`} style={style} />
}

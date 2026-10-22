import type { FluidSplat } from './light-mist-input';

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface PingPong {
  read: RenderTarget;
  write: RenderTarget;
  swap(): void;
}

interface ShaderUniform {
  location: WebGLUniformLocation | null;
  type: number;
}

interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Record<string, ShaderUniform>;
}

type UniformValue = RenderTarget | number | number[];
type ShaderName = keyof typeof shaders;

const vertex = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vUv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}`;

const header = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 color;
`;

const noise = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1)), u.x), u.y);
}
float fbm(vec2 p) {
  float sum = 0.0, amplitude = 0.5;
  mat2 rotate = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    sum += amplitude * noise(p);
    p = rotate * p * 2.03 + 13.1;
    amplitude *= 0.5;
  }
  return sum;
}`;

const shaders = {
  splat: `
    uniform sampler2D source;
    uniform vec2 point;
    uniform vec3 ink;
    uniform float radius;
    uniform float aspect;
    void main() {
      vec2 p = vUv - point;
      p.x *= aspect;
      float weight = exp(-dot(p, p) / (radius * radius));
      color = vec4(texture(source, vUv).rgb + ink * weight, 1.0);
    }`,
  advect: `
    uniform sampler2D velocity;
    uniform sampler2D source;
    uniform float dt;
    uniform float decay;
    uniform float aspect;
    vec4 bilerp(sampler2D image, vec2 uv) {
      vec2 size = vec2(textureSize(image, 0));
      vec2 p = uv * size - 0.5;
      vec2 f = fract(p), i = floor(p);
      vec2 pixel = 1.0 / size;
      return mix(mix(texture(image, (i + 0.5) * pixel),
                     texture(image, (i + vec2(1.5, 0.5)) * pixel), f.x),
                 mix(texture(image, (i + vec2(0.5, 1.5)) * pixel),
                     texture(image, (i + 1.5) * pixel), f.x), f.y);
    }
    void main() {
      vec2 v = bilerp(velocity, vUv).xy;
      vec2 coord = vUv - dt * v / vec2(aspect, 1.0);
      color = bilerp(source, coord) * exp(-decay * dt);
    }`,
  curl: `
    uniform sampler2D velocity;
    uniform vec2 texel;
    void main() {
      float l = texture(velocity, vUv - vec2(texel.x, 0)).y;
      float r = texture(velocity, vUv + vec2(texel.x, 0)).y;
      float b = texture(velocity, vUv - vec2(0, texel.y)).x;
      float t = texture(velocity, vUv + vec2(0, texel.y)).x;
      color = vec4(0.5 * (r - l - t + b), 0, 0, 1);
    }`,
  vorticity: `
    uniform sampler2D velocity;
    uniform sampler2D curls;
    uniform vec2 texel;
    uniform float dt;
    void main() {
      float l = abs(texture(curls, vUv - vec2(texel.x, 0)).r);
      float r = abs(texture(curls, vUv + vec2(texel.x, 0)).r);
      float b = abs(texture(curls, vUv - vec2(0, texel.y)).r);
      float t = abs(texture(curls, vUv + vec2(0, texel.y)).r);
      float c = texture(curls, vUv).r;
      vec2 force = 0.5 * vec2(t - b, l - r);
      force /= length(force) + 0.0001;
      force *= 24.0 * c;
      color = vec4(clamp(texture(velocity, vUv).xy + force * dt, -3.0, 3.0), 0, 1);
    }`,
  divergence: `
    uniform sampler2D velocity;
    uniform vec2 texel;
    void main() {
      float l = texture(velocity, vUv - vec2(texel.x, 0)).x;
      float r = texture(velocity, vUv + vec2(texel.x, 0)).x;
      float b = texture(velocity, vUv - vec2(0, texel.y)).y;
      float t = texture(velocity, vUv + vec2(0, texel.y)).y;
      vec2 c = texture(velocity, vUv).xy;
      if (vUv.x < texel.x) l = -c.x;
      if (vUv.x > 1.0 - texel.x) r = -c.x;
      if (vUv.y < texel.y) b = -c.y;
      if (vUv.y > 1.0 - texel.y) t = -c.y;
      color = vec4(0.5 * (r - l + t - b), 0, 0, 1);
    }`,
  pressure: `
    uniform sampler2D source;
    uniform sampler2D divergence;
    uniform vec2 texel;
    void main() {
      float l = texture(source, vUv - vec2(texel.x, 0)).r;
      float r = texture(source, vUv + vec2(texel.x, 0)).r;
      float b = texture(source, vUv - vec2(0, texel.y)).r;
      float t = texture(source, vUv + vec2(0, texel.y)).r;
      color = vec4((l + r + b + t - texture(divergence, vUv).r) * 0.25, 0, 0, 1);
    }`,
  project: `
    uniform sampler2D velocity;
    uniform sampler2D pressure;
    uniform vec2 texel;
    void main() {
      float l = texture(pressure, vUv - vec2(texel.x, 0)).r;
      float r = texture(pressure, vUv + vec2(texel.x, 0)).r;
      float b = texture(pressure, vUv - vec2(0, texel.y)).r;
      float t = texture(pressure, vUv + vec2(0, texel.y)).r;
      color = vec4(texture(velocity, vUv).xy - 0.5 * vec2(r - l, t - b), 0, 1);
    }`,
  display: `
    uniform sampler2D dye;
    uniform sampler2D velocity;
    uniform float time;
    uniform float aspect;
    uniform vec2 resolution;
    ${noise}
    void main() {
      vec2 v = texture(velocity, vUv).xy;
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      p += v * 0.12;
      float clock = time * 0.032;
      vec2 warp = vec2(fbm(p * 1.5 + vec2(clock, 2.0)),
                       fbm(p * 1.7 + vec2(4.0, -clock * 0.7)));
      float cloud = fbm(p * 2.3 + warp * 2.8 + vec2(clock * 0.2, 8.0));
      float sweep = p.y - p.x * 0.29 + (warp.x - 0.45) * 0.78;
      float veil = exp(-pow((sweep - 0.02) * 3.8, 2.0));
      float folds = pow(0.5 + 0.5 * sin(sweep * 15.0 + cloud * 8.0), 3.0);
      float light = veil * (0.11 + cloud * 0.31 + folds * 0.08);
      float focus = 0.35 + 0.65 * smoothstep(-aspect * 0.45, aspect * 0.3, p.x);
      vec3 blue = vec3(0.21, 0.27, 0.62);
      vec3 violet = vec3(0.43, 0.28, 0.60);
      vec3 silver = vec3(0.39, 0.64, 0.72);
      vec3 tint = mix(violet, blue, smoothstep(-0.5, 0.6, p.x));
      tint = mix(tint, silver, smoothstep(0.56, 0.83, cloud) * 0.7);
      vec3 base = vec3(0.025, 0.029, 0.053) + tint * light * focus;
      float ribbon = exp(-abs(sweep + cloud * 0.10 - 0.08) * 36.0);
      base += silver * ribbon * cloud * focus * 0.065;
      vec3 ink = max(texture(dye, vUv).rgb, 0.0);
      vec2 pixel = 1.0 / vec2(textureSize(dye, 0));
      float l = length(texture(dye, vUv - vec2(pixel.x, 0)).rgb);
      float r = length(texture(dye, vUv + vec2(pixel.x, 0)).rgb);
      float b = length(texture(dye, vUv - vec2(0, pixel.y)).rgb);
      float t = length(texture(dye, vUv + vec2(0, pixel.y)).rgb);
      float edge = length(vec2(r - l, t - b));
      vec3 mist = 1.0 - exp(-ink * 1.2);
      mist += vec3(0.45, 0.64, 0.76) * min(edge * 0.14, 0.11);
      vec3 finalColor = base + mist * 0.75;
      float vignette = 1.0 - 0.27 * smoothstep(0.2, 0.85, length((vUv - 0.5) * vec2(1.0, 0.9)));
      finalColor *= vignette;
      float grain = hash(floor(vUv * resolution)) - 0.5;
      finalColor += grain * 0.009;
      color = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
    }`,
};

export class Flow {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  time: number;
  vao: WebGLVertexArrayObject;
  programs: Record<string, ShaderProgram> = {};
  targets: RenderTarget[] = [];
  aspect!: number;
  velocity!: PingPong;
  pressure!: PingPong;
  curls!: RenderTarget;
  divergence!: RenderTarget;
  dye!: PingPong;
  texel!: [number, number];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'low-power', preserveDrawingBuffer: false,
    });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('WebGL floating-point rendering is unavailable');
    }
    this.gl = gl;
    this.time = 0;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Unable to allocate the fluid vertex array');
    this.vao = vao;
    try {
      gl.bindVertexArray(this.vao);
      for (const [name, fragment] of Object.entries(shaders)) {
        this.programs[name] = this.program(fragment);
      }
      this.resize();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  program(fragment: string): ShaderProgram {
    const gl = this.gl;
    const compile = (type: number, text: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Unable to allocate a fluid shader');
      try {
        gl.shaderSource(shader, text);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader) ?? 'Unable to compile a fluid shader');
        }
        return shader;
      } catch (error) {
        gl.deleteShader(shader);
        throw error;
      }
    };
    const vert = compile(gl.VERTEX_SHADER, vertex);
    let frag: WebGLShader | null = null;
    let program: WebGLProgram | null = null;
    try {
      frag = compile(gl.FRAGMENT_SHADER, header + fragment);
      program = gl.createProgram();
      if (!program) throw new Error('Unable to allocate a fluid program');
      gl.attachShader(program, vert);
      gl.attachShader(program, frag);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? 'Unable to link a fluid program');
      }
      const uniforms: Record<string, ShaderUniform> = {};
      for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
        const uniform = gl.getActiveUniform(program, i);
        if (!uniform) throw new Error('Unable to read a fluid shader uniform');
        const { name, type } = uniform;
        uniforms[name] = { location: gl.getUniformLocation(program, name), type };
      }
      return { program, uniforms };
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      gl.deleteShader(vert);
      if (frag) gl.deleteShader(frag);
    }
  }

  target(width: number, height: number): RenderTarget {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Unable to allocate a fluid texture');
    let framebuffer: WebGLFramebuffer | null = null;
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      framebuffer = gl.createFramebuffer();
      if (!framebuffer) throw new Error('Unable to allocate a fluid framebuffer');
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('The fluid framebuffer is incomplete');
      }
    } catch (error) {
      gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      throw error;
    }
    const target: RenderTarget = { texture, framebuffer, width, height };
    this.targets.push(target);
    this.clear(target);
    return target;
  }

  pair(width: number, height: number): PingPong {
    return { read: this.target(width, height), write: this.target(width, height), swap() {
      [this.read, this.write] = [this.write, this.read];
    } };
  }

  clear(target: RenderTarget): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  resize(): void {
    const gl = this.gl;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.aspect = width / height;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5, 1600 / width);
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    for (const target of this.targets) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    this.targets = [];
    const coarse = matchMedia('(pointer: coarse)').matches;
    const shortSide = coarse ? 96 : 144;
    const simWidth = Math.round(shortSide * Math.max(this.aspect, 1));
    const simHeight = Math.round(shortSide / Math.min(this.aspect, 1));
    const inkSide = coarse ? 256 : 512;
    this.velocity = this.pair(simWidth, simHeight);
    this.pressure = this.pair(simWidth, simHeight);
    this.curls = this.target(simWidth, simHeight);
    this.divergence = this.target(simWidth, simHeight);
    this.dye = this.pair(Math.round(inkSide * Math.max(this.aspect, 1)), Math.round(inkSide / Math.min(this.aspect, 1)));
    this.texel = [1 / simWidth, 1 / simHeight];
    this.render();
  }

  draw(name: ShaderName, target: RenderTarget | null, values: Record<string, UniformValue>): void {
    const gl = this.gl;
    const { program, uniforms } = this.programs[name];
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, target?.width ?? this.canvas.width, target?.height ?? this.canvas.height);
    let slot = 0;
    for (const [name, value] of Object.entries(values)) {
      const uniform = uniforms[name];
      if (!uniform) continue;
      const { location, type } = uniform;
      if (type === gl.SAMPLER_2D) {
        gl.activeTexture(gl.TEXTURE0 + slot);
        gl.bindTexture(gl.TEXTURE_2D, (value as RenderTarget).texture);
        gl.uniform1i(location, slot++);
      } else if (type === gl.FLOAT_VEC2) gl.uniform2fv(location, value as number[]);
      else if (type === gl.FLOAT_VEC3) gl.uniform3fv(location, value as number[]);
      else gl.uniform1f(location, value as number);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  splat(point: FluidSplat): void {
    const hue = 0.5 + 0.5 * Math.sin(this.time * 0.45 + point.x * 3.0 + point.y * 2.0);
    const tint = [0.32 + hue * 0.15, 0.31 + hue * 0.40, 0.78 + hue * 0.1];
    this.draw('splat', this.velocity.write, {
      source: this.velocity.read, point: [point.x, point.y],
      ink: [point.dx, point.dy, 0], radius: point.radius * 1.35, aspect: this.aspect,
    });
    this.velocity.swap();
    this.draw('splat', this.dye.write, {
      source: this.dye.read, point: [point.x, point.y],
      ink: tint.map(c => c * point.amount), radius: point.radius, aspect: this.aspect,
    });
    this.dye.swap();
  }

  step(dt: number, splats: FluidSplat[]): void {
    this.time += dt;
    for (const point of splats) this.splat(point);
    this.draw('advect', this.velocity.write, {
      velocity: this.velocity.read, source: this.velocity.read,
      dt, decay: 0.65, aspect: this.aspect,
    });
    this.velocity.swap();
    this.draw('curl', this.curls, { velocity: this.velocity.read, texel: this.texel });
    this.draw('vorticity', this.velocity.write, {
      velocity: this.velocity.read, curls: this.curls, texel: this.texel, dt,
    });
    this.velocity.swap();
    this.draw('divergence', this.divergence, { velocity: this.velocity.read, texel: this.texel });
    this.clear(this.pressure.read);
    for (let i = 0; i < 12; i++) {
      this.draw('pressure', this.pressure.write, {
        source: this.pressure.read, divergence: this.divergence, texel: this.texel,
      });
      this.pressure.swap();
    }
    this.draw('project', this.velocity.write, {
      velocity: this.velocity.read, pressure: this.pressure.read, texel: this.texel,
    });
    this.velocity.swap();
    this.draw('advect', this.dye.write, {
      velocity: this.velocity.read, source: this.dye.read, dt, decay: 0.38, aspect: this.aspect,
    });
    this.dye.swap();
    this.render();
  }

  render(): void {
    this.draw('display', null, {
      dye: this.dye.read, velocity: this.velocity.read, time: this.time,
      aspect: this.aspect, resolution: [this.canvas.width, this.canvas.height],
    });
  }

  reset(): void {
    for (const target of this.targets) this.clear(target);
    this.time = 0;
    this.render();
  }

  destroy(): void {
    const gl = this.gl;
    for (const target of this.targets) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    for (const { program } of Object.values(this.programs)) gl.deleteProgram(program);
    gl.deleteVertexArray(this.vao);
    this.targets = [];
  }
}

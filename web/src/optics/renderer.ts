/** Single full-viewport triangle, in CSS pixel units (never devicePixelRatio). */
export function bufferSize(width: number, height: number, pixels: number) {
  const scale = Math.min(
    1 / 3,
    Math.sqrt(pixels / Math.max(1, width * height)),
  );
  return [
    Math.max(1, Math.floor(width * scale)),
    Math.max(1, Math.floor(height * scale)),
  ] as const;
}
const vertex = `attribute vec2 p; varying vec2 uv;
void main(){uv=p*.5+.5; gl_Position=vec4(p,0.,1.);}`;
// Cross-sections of a crystal lens. Static flecks are sampled in scene space;
// two depths drift at different speeds, with no emitters, textures or feedback.
const fragment = `precision mediump float;
varying vec2 uv; uniform vec2 origin, tilt; uniform vec3 silver, violet; uniform float phase, aspect;
void main(){
 vec2 p=(uv-origin)*vec2(aspect,1.);
 vec2 drift=vec2(cos(phase),sin(phase))*.015+tilt*.025;
 vec2 q=p+drift;
 float d=length(q*vec2(1.,1.8));
 float flare=exp(-d*d*15.);
 float arc=exp(-34.*abs(length(q*vec2(1.4,2.7))-.42+.035*cos(q.x*13.+phase)));
 vec2 cell=(p-drift*.4)*110.;
 float seed=fract(sin(dot(floor(cell),vec2(17.1,31.7)))*121.3);
 float dust=step(.978,seed)*(1.-smoothstep(.03,.18,length(fract(cell)-.5)));
 gl_FragColor=vec4(mix(silver,violet,smoothstep(-.35,.35,q.x)),flare*(.036+.032*arc+.024*dust));
}`;

function channels(css: string) {
  // Read resolved color properties, not the unparsed light-dark custom property.
  const values = css.match(/[\d.]+/g)?.map(Number) ?? [];
  return values
    .slice(0, 3)
    .map((n) => (css.startsWith("color(srgb ") ? n : n / 255));
}
export function createLens(canvas: HTMLCanvasElement) {
  let gl: WebGLRenderingContext | null;
  try {
    gl = canvas.getContext("webgl", {
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const dispose = () => {
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL program binding, not a React hook
    gl.useProgram(null);
    for (const shader of shaders) gl.deleteShader(shader);
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
  };
  try {
    if (!program || !buffer) throw Error();
    for (const [kind, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(kind);
      if (!shader) throw Error();
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error();
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL program binding, not a React hook
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const location = (name: string) => gl.getUniformLocation(program, name);
    const silver = location("silver"),
      violet = location("violet"),
      aspect = location("aspect"),
      phase = location("phase"),
      origin = location("origin"),
      tilt = location("tilt");
    return {
      dispose,
      configure(css: CSSStyleDeclaration, mark?: DOMRect) {
        const [w, h] = bufferSize(
          canvas.clientWidth,
          canvas.clientHeight,
          Number(css.getPropertyValue("--ambient-pixels")) || 256000,
        );
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        gl.viewport(0, 0, w, h);
        const box = canvas.getBoundingClientRect();
        const x = mark ? (mark.x + mark.width / 2 - box.x) / box.width : 0.5;
        const y = mark ? (mark.y + mark.height / 2 - box.y) / box.height : 0.38;
        gl.uniform2f(origin, x, 1 - y);
        gl.uniform1f(aspect, w / h);
        gl.uniform3fv(silver, channels(css.color));
        gl.uniform3fv(violet, channels(css.borderTopColor));
      },
      draw(time: number, x: number, y: number) {
        gl.uniform2f(tilt, x, y);
        gl.uniform1f(phase, (time / 6500) % (2 * Math.PI));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
  } catch {
    dispose();
    return null;
  }
}

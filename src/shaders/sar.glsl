uniform sampler2D colorTexture;
uniform float u_noise;
uniform float u_scanlines;
uniform float u_vignette;

in vec2 v_textureCoordinates;

// SAR — synthetic aperture radar. Radar backscatter emphasises structure:
// edges, buildings, and terrain relief return strongly; smooth surfaces
// (water, flat ground) are dark. Rendered as Sobel edge-enhanced amber
// monochrome with characteristic speckle.

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

float lumAt(vec2 uv) {
  vec3 c = texture(colorTexture, uv).rgb;
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

  // --- Sobel edge detection (radar returns from structure) ---
  vec2 texel = 1.0 / czm_viewport.zw;
  float tl = lumAt(uv + texel * vec2(-1.0,  1.0));
  float t  = lumAt(uv + texel * vec2( 0.0,  1.0));
  float tr = lumAt(uv + texel * vec2( 1.0,  1.0));
  float l  = lumAt(uv + texel * vec2(-1.0,  0.0));
  float r  = lumAt(uv + texel * vec2( 1.0,  0.0));
  float bl = lumAt(uv + texel * vec2(-1.0, -1.0));
  float b  = lumAt(uv + texel * vec2( 0.0, -1.0));
  float br = lumAt(uv + texel * vec2( 1.0, -1.0));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  float edge = clamp(length(vec2(gx, gy)) * 2.2, 0.0, 1.0);

  // --- Compose: dark floor + faint terrain backscatter + bright edges ---
  vec3 sar = vec3(0.05, 0.025, 0.005)                    // noise floor
           + lum * 0.35 * vec3(0.55, 0.30, 0.06)         // diffuse backscatter
           + edge * vec3(1.0, 0.62, 0.12);               // structural returns

  // --- Multiplicative speckle (defining SAR artifact) ---
  float speckle = rand(uv * (czm_frameNumber * 0.0001 + 7.0));
  sar *= mix(1.0, 0.55 + speckle * 0.9, u_noise * 0.7);

  // --- Preserve entity colors, brightened (keeps layer color-coding) ---
  float maxC = max(color.r, max(color.g, color.b));
  float minC = min(color.r, min(color.g, color.b));
  float sat = maxC > 0.01 ? (maxC - minC) / maxC : 0.0;
  float entity = smoothstep(0.5, 0.8, sat) * smoothstep(0.3, 0.55, maxC);
  sar = mix(sar, color.rgb * 1.25, entity * 0.9);

  // --- Slow azimuth scan shimmer ---
  float scan = sin(uv.y * 400.0 + czm_frameNumber * 0.35) * 0.5 + 0.5;
  sar *= 1.0 - u_scanlines * 0.07 * scan;

  // --- Vignette ---
  float dist = length(uv - 0.5) * 2.0;
  float vig = 1.0 - smoothstep(0.7, 1.5, dist * u_vignette);
  sar *= vig;

  out_FragColor = vec4(sar, color.a);
}

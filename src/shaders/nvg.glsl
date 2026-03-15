uniform sampler2D colorTexture;
uniform float u_grain;
uniform float u_scanlines;
uniform float u_vignette;

in vec2 v_textureCoordinates;

// Pseudo-random noise
float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);

  // --- Desaturate (luminance) ---
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

  // --- Green phosphor tint ---
  vec3 nvg = vec3(lum) * vec3(0.1, 1.0, 0.15);

  // --- Simple bloom: average neighbors ---
  float texelX = 1.0 / 1920.0;
  float texelY = 1.0 / 1080.0;
  float bloomSum = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      vec4 s = texture(colorTexture, uv + vec2(float(x) * texelX, float(y) * texelY));
      bloomSum += dot(s.rgb, vec3(0.299, 0.587, 0.114));
    }
  }
  bloomSum /= 25.0;
  nvg += vec3(0.05, 0.5, 0.07) * max(bloomSum - 0.3, 0.0) * 1.5;

  // --- Film grain ---
  float noise = rand(uv * czm_frameNumber * 0.01) * 2.0 - 1.0;
  nvg += noise * u_grain * 0.08;

  // --- Scanlines ---
  float scanline = sin(uv.y * 800.0) * 0.5 + 0.5;
  nvg *= 1.0 - u_scanlines * 0.15 * scanline;

  // --- Circular vignette ---
  float dist = length(uv - 0.5) * 2.0;
  float vig = 1.0 - smoothstep(0.6, 1.4, dist * u_vignette);
  nvg *= vig;

  out_FragColor = vec4(nvg, color.a);
}

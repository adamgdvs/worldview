uniform sampler2D colorTexture;
uniform float u_noise;
uniform float u_contrast;
uniform float u_vignette;

in vec2 v_textureCoordinates;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);

  // --- Luminance (grayscale) ---
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

  // --- Invert for white-hot ---
  lum = 1.0 - lum;

  // --- High contrast gamma curve ---
  lum = pow(lum, 1.0 / max(u_contrast, 0.1));

  // --- Dense noise speckle ---
  float n = rand(uv * czm_frameNumber * 0.013 + vec2(0.5, 0.3)) * 2.0 - 1.0;
  lum += n * u_noise * 0.1;
  lum = clamp(lum, 0.0, 1.0);

  // --- Slight warm tint (thermal look) ---
  vec3 thermal = vec3(lum * 1.05, lum * 0.98, lum * 0.9);

  // --- Circular vignette ---
  float dist = length(uv - 0.5) * 2.0;
  float vig = 1.0 - smoothstep(0.5, 1.5, dist * u_vignette);
  thermal *= vig;

  out_FragColor = vec4(thermal, color.a);
}

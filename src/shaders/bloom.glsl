uniform sampler2D colorTexture;
uniform float u_intensity;

in vec2 v_textureCoordinates;

void main() {
  vec2 uv = v_textureCoordinates;
  vec4 color = texture(colorTexture, uv);
  vec2 texel = 1.0 / czm_viewport.zw;

  // Wide-radius blur of the full scene (no threshold — blur everything)
  // Then blend the blurred version on top for a cinematic soft glow.
  // Bright points (entities, icons) naturally produce stronger halos
  // because they contribute more energy to the blur.

  vec3 blurred = vec3(0.0);
  float totalWeight = 0.0;

  // 8 directions
  const vec2 dirs[8] = vec2[8](
    vec2(1.0, 0.0), vec2(-1.0, 0.0),
    vec2(0.0, 1.0), vec2(0.0, -1.0),
    vec2(0.707, 0.707), vec2(-0.707, 0.707),
    vec2(0.707, -0.707), vec2(-0.707, -0.707)
  );

  // Sample at multiple radii for a wide soft blur
  // Ring 1: 3px
  for (int i = 0; i < 8; i++) {
    blurred += texture(colorTexture, uv + dirs[i] * texel * 3.0).rgb * 1.0;
    totalWeight += 1.0;
  }
  // Ring 2: 7px
  for (int i = 0; i < 8; i++) {
    blurred += texture(colorTexture, uv + dirs[i] * texel * 7.0).rgb * 0.8;
    totalWeight += 0.8;
  }
  // Ring 3: 14px
  for (int i = 0; i < 8; i++) {
    blurred += texture(colorTexture, uv + dirs[i] * texel * 14.0).rgb * 0.5;
    totalWeight += 0.5;
  }
  // Ring 4: 24px — wide outer halo
  for (int i = 0; i < 8; i++) {
    blurred += texture(colorTexture, uv + dirs[i] * texel * 24.0).rgb * 0.3;
    totalWeight += 0.3;
  }

  blurred /= totalWeight;

  // Soft-light blend: screen-like compositing of blur onto original
  // This brightens without washing out — glow wraps around bright points
  float t = u_intensity; // 0–1
  vec3 result = color.rgb + (blurred - color.rgb * 0.5) * t;

  // Clamp to prevent over-saturation
  out_FragColor = vec4(min(result, 1.0), color.a);
}

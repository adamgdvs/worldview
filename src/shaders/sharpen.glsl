uniform sampler2D colorTexture;
uniform float u_sharpen;

in vec2 v_textureCoordinates;

void main() {
  vec2 uv = v_textureCoordinates;
  vec2 texel = 1.0 / czm_viewport.zw;

  vec4 center = texture(colorTexture, uv);

  // Sample 4 neighbors for unsharp mask
  vec4 top    = texture(colorTexture, uv + vec2(0.0,  texel.y));
  vec4 bottom = texture(colorTexture, uv + vec2(0.0, -texel.y));
  vec4 left   = texture(colorTexture, uv + vec2(-texel.x, 0.0));
  vec4 right  = texture(colorTexture, uv + vec2( texel.x, 0.0));

  vec4 blur = (top + bottom + left + right) * 0.25;

  // Unsharp mask: center + (center - blur) * strength
  vec3 sharpened = center.rgb + (center.rgb - blur.rgb) * u_sharpen;

  out_FragColor = vec4(clamp(sharpened, 0.0, 1.0), center.a);
}

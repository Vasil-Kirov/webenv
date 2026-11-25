#version 300 es
precision mediump float;

out vec4 OutColor;

in vec2 oTexCoord;

uniform sampler2D Tex;
uniform vec2 Pixels;

void main(void)
{
	vec2 p = oTexCoord;
	p.x -= mod(p.x, 1.0/Pixels.x);
	p.y -= mod(p.y, 1.0/Pixels.y);

	vec3 Color = texture(Tex, p).rgb;
	OutColor = vec4(Color, 1.0);
}



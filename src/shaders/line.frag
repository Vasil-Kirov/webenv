#version 300 es
precision mediump float;

out vec4 OutColor;
uniform vec4 Color;

void main() {
	OutColor = Color;
}


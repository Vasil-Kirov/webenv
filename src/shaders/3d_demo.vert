#version 300 es
precision mediump float;

layout (location = 0) in vec3 iPosition;
layout (location = 1) in vec3 iNormal;
layout (location = 2) in vec2 iTexCoord;
layout (location = 3) in vec4 iTexBox;
layout (location = 4) in mat4 iModel;

out vec2 oTexCoord;
out vec3 oWorldPos;
out vec3 oNormal;

layout(std140) uniform MVP {
	mat4 View;
	mat4 Projection;
};

void main() {
	vec4 WorldPos = iModel * vec4(iPosition, 1.0);
	gl_Position = Projection * View * WorldPos;
	oTexCoord = iTexCoord;
	oWorldPos = WorldPos.xyz;
	oNormal = mat3(transpose(inverse(iModel))) * iNormal;
}



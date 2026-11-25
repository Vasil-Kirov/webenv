#version 300 es
precision highp float;

out vec4 OutColor;

in vec2 oTexCoord;
in vec3 oWorldPos;
in vec3 oNormal;

uniform sampler2D Tex;
uniform vec3 ViewPos;

struct dir_light {
	vec3 Direction;

	vec3 Ambient;
	vec3 Diffuse;
	vec3 Specular;
};

struct point_light {    
    vec3 Position;
    
    float Constant;
    float Linear;
    float Quadratic;  

    vec3 Ambient;
    vec3 Diffuse;
    vec3 Specular;
};  
#define NR_POINT_LIGHTS 8

layout(std140) uniform Lights {
	dir_light DirLight;
	point_light PointLights[NR_POINT_LIGHTS];
};

layout(std140) uniform Material {
	vec3 MatDiffuse;
	vec3 MatSpecular;
	float MatShininess;
};

vec3 CalcDirLight(dir_light Light, vec3 Normal, vec3 ViewDir)
{
    vec3 LightDir = normalize(-Light.Direction);

    // diffuse shading
    float Diff = max(dot(Normal, LightDir), 0.0);
    // specular shading
    vec3 ReflectDir = reflect(-LightDir, Normal);
    float Spec = pow(max(dot(ViewDir, ReflectDir), 0.0), MatShininess);
    // combine results
    vec3 Ambient  = Light.Ambient  * MatDiffuse;
    vec3 Diffuse  = Light.Diffuse  * Diff * MatDiffuse;
    vec3 Specular = Light.Specular * Spec * MatSpecular;
    return (Ambient + Diffuse + Specular);
}

vec3 CalcPointLight(point_light Light, vec3 Normal, vec3 FragPos, vec3 ViewDir)
{
	vec3 LightDir = normalize(Light.Position - FragPos);
    // diffuse shading
    float Diff = max(dot(Normal, LightDir), 0.0);
    // specular shading
    vec3 ReflectDir = reflect(-LightDir, Normal);
    float Spec = pow(max(dot(ViewDir, ReflectDir), 0.0), MatShininess);
    // attenuation
    float Distance    = length(Light.Position - FragPos);
    float Attenuation = 1.0 / (Light.Constant + Light.Linear * Distance + 
  			     Light.Quadratic * (Distance * Distance));    
    // combine results
    vec3 Ambient  = Light.Ambient  * MatDiffuse;
    vec3 Diffuse  = Light.Diffuse  * Diff * MatDiffuse;
    vec3 Specular = Light.Specular * Spec * MatSpecular;
    Ambient  *= Attenuation;
    Diffuse  *= Attenuation;
    Specular *= Attenuation;
    return (Ambient + Diffuse + Specular);
}

void main() {
    vec4 sampled = texture(Tex, oTexCoord);
	vec3 Norm = normalize(oNormal);
	vec3 ViewDir = normalize(ViewPos - oWorldPos);

	vec3 Result = CalcDirLight(DirLight, Norm, ViewDir);

	for (int i = 0; i < NR_POINT_LIGHTS; ++i)
		Result += CalcPointLight(PointLights[i], Norm, oWorldPos, ViewDir);

    OutColor = vec4(sampled.rgb * Result, sampled.a);
}

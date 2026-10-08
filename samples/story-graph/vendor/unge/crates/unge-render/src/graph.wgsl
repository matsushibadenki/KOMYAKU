struct Camera { origin_zoom: vec4<f32>, size: vec4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var portraits: texture_2d<f32>;
@group(0) @binding(2) var portrait_sampler: sampler;
fn target_color(rgb: vec3<f32>) -> vec3<f32> {
    let linear = select(pow((rgb+vec3(0.055))/1.055,vec3(2.4)),rgb/12.92,rgb<=vec3(0.04045));
    return select(rgb,linear,camera.origin_zoom.w>0.5);
}
struct Output {
    @builtin(position) position: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) half_size: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) params: vec4<f32>,
    @location(4) world: vec2<f32>,
};
@vertex fn vs(@builtin(vertex_index) i: u32, @location(0) rect: vec4<f32>, @location(1) color: vec4<f32>, @location(2) params: vec4<f32>) -> Output {
    let corners = array<vec2<f32>,6>(vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
    let local = corners[i]*rect.zw*0.5;
    let c = cos(params.x); let s = sin(params.x);
    let world = rect.xy+vec2(c*local.x-s*local.y,s*local.x+c*local.y);
    let screen = (world-camera.origin_zoom.xy)*camera.origin_zoom.z;
    var out: Output;
    out.position = vec4(screen.x/camera.size.x*2.-1.,1.-screen.y/camera.size.y*2.,0.,1.);
    out.local=local; out.half_size=rect.zw*0.5; out.color=color; out.params=params; out.world=world;
    return out;
}
@fragment fn fs(in: Output) -> @location(0) vec4<f32> {
    if in.params.z < -0.5 {
        let edge = abs(in.local.y)-in.half_size.y*(0.5-in.local.x/(2.*in.half_size.x));
        let alpha = 1.-smoothstep(-1./camera.origin_zoom.z,0.,edge);
        return vec4(target_color(in.color.rgb),in.color.a*alpha);
    }
    if in.params.z > 0.5 {
        let spacing = select(24.,120.,camera.origin_zoom.z < 0.3);
        let cell = abs(fract(in.world/spacing-0.5)-0.5)*spacing;
        if in.color.r > 0.5 {
            // Quiet dot lattice: keep the paper continuous behind relationship cables.
            let dot = 1.-smoothstep(0.65/camera.origin_zoom.z,1.25/camera.origin_zoom.z,length(cell));
            return vec4(target_color(in.color.rgb-vec3(dot*0.09)),1.);
        }
        let line = 1.-smoothstep(0.,1.2/camera.origin_zoom.z,min(cell.x,cell.y));
        let shade = select(0.025,-0.035,in.color.r > 0.5);
        return vec4(target_color(in.color.rgb+vec3(line*shade)),1.);
    }
    let radius = min(in.params.y,min(in.half_size.x,in.half_size.y));
    let q = abs(in.local)-in.half_size+vec2(radius);
    let distance = length(max(q,vec2(0.)))+min(max(q.x,q.y),0.)-radius;
    let alpha = 1.-smoothstep(-1./camera.origin_zoom.z,0.,distance);
    if in.params.w > 0.5 {
        let slot = u32(in.params.w - 1.);
        let origin = vec2<f32>(f32(slot%16u),f32(slot/16u))*128.;
        let uv = clamp(in.local/(in.half_size*2.)+vec2(0.5),vec2(0.),vec2(1.));
        // Half-pixel inset prevents filtering into a neighboring portrait.
        let pixel = origin+vec2(0.5)+uv*127.;
        let photo = textureSampleLevel(portraits,portrait_sampler,pixel/2048.,0.);
        return vec4(photo.rgb,photo.a*alpha);
    }
    return vec4(target_color(in.color.rgb),in.color.a*alpha);
}

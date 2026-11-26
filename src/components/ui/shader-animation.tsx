import { useEffect, useRef } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";

/**
 * Adapted from 21st.dev community component: Shader Animation (@designali-in/shader-animation)
 * GPU-accelerated Three.js ShaderMaterial harmonic concentric topographic/atmospheric waves
 * tuned to GreenMap's deep navy, forest green, and emerald palette.
 */
interface ShaderAnimationProps {
  className?: string;
}

export function ShaderAnimation({ className }: ShaderAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer | null = null;
    let animationId = 0;

    try {
      const camera = new THREE.Camera();
      camera.position.z = 1;

      const scene = new THREE.Scene();
      const geometry = new THREE.PlaneGeometry(2, 2);

      const uniforms = {
        time: { value: 1.0 },
        resolution: { value: new THREE.Vector2() },
      };

      const vertexShader = `
        void main() {
          gl_Position = vec4( position, 1.0 );
        }
      `;

      const fragmentShader = `
        #define TWO_PI 6.2831853072
        #define PI 3.14159265359

        precision highp float;
        uniform vec2 resolution;
        uniform float time;

        void main(void) {
          vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
          float t = time * 0.035;
          float lineWidth = 0.0022;

          vec3 navyBase = vec3(0.027, 0.067, 0.118);
          vec3 forestTint = vec3(0.051, 0.290, 0.227);
          vec3 emeraldGlow = vec3(0.063, 0.725, 0.506);

          float intensity = 0.0;
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            intensity += lineWidth * (fi + 1.0) / abs(
              fract(t + fi * 0.08) * 3.8 - length(uv * vec2(0.85, 1.15)) + mod(uv.x + uv.y, 0.25) * 0.2
            );
          }

          vec3 col = navyBase;
          col += forestTint * clamp(intensity * 0.45, 0.0, 0.55);
          col += emeraldGlow * clamp(intensity * 0.28, 0.0, 0.45);

          gl_FragColor = vec4(col, 1.0);
        }
      `;

      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
      });

      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      const onResize = () => {
        if (!container || !renderer) return;
        const width = container.clientWidth || 1;
        const height = container.clientHeight || 1;
        renderer.setSize(width, height);
        uniforms.resolution.value.x = renderer.domElement.width;
        uniforms.resolution.value.y = renderer.domElement.height;
      };

      onResize();
      window.addEventListener("resize", onResize, false);

      const animate = () => {
        if (!renderer) return;
        if (!prefersReducedMotion) {
          animationId = requestAnimationFrame(animate);
          uniforms.time.value += 0.04;
        }
        renderer.render(scene, camera);
      };

      animate();

      return () => {
        window.removeEventListener("resize", onResize);
        cancelAnimationFrame(animationId);
        if (renderer && renderer.domElement && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        renderer?.dispose();
        geometry.dispose();
        material.dispose();
      };
    } catch {
      return undefined;
    }
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_rgba(16,185,129,0.22),_transparent_60%),linear-gradient(135deg,#07111e_0%,#0d2b2e_100%)]",
        className
      )}
    />
  );
}

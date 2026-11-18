import React, { Suspense, useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Line, ContactShadows } from "@react-three/drei";
import * as THREE from "three";

/* ============ Floating data nodes ============ */
function Nodes() {
  const group = useRef();
  useFrame((state) => {
    group.current.rotation.y = state.clock.elapsedTime * 0.05;
  });

  const nodes = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 24; i++) {
      const theta = (i / 24) * Math.PI * 2;
      const r = 2.6 + (i % 4) * 0.5;
      arr.push({
        pos: [Math.cos(theta) * r, (Math.sin(i) * 1.2 || 0), Math.sin(theta) * r],
        color: i % 3 === 0 ? "#06b6d4" : i % 3 === 1 ? "#6366f1" : "#a855f7",
        size: 0.05 + (i % 3) * 0.025,
      });
    }
    return arr;
  }, []);

  return (
    <group ref={group}>
      {nodes.map((n, i) => (
        <Float key={i} speed={1.5} rotationIntensity={0.4} floatIntensity={1.2}>
          <mesh position={n.pos}>
            <sphereGeometry args={[n.size, 16, 16]} />
            <meshStandardMaterial color={n.color} emissive={n.color} emissiveIntensity={1.2} />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

/* ============ Animated distribution routes ============ */
function Routes() {
  const lineRef = useRef();
  const lines = useMemo(() => {
    const pts = [
      [[0, 0, 0], [2.2, 0.4, 1.6]],
      [[0, 0, 0], [-2.4, 0.2, 1.4]],
      [[0, 0, 0], [1.8, -0.3, -2]],
      [[0, 0, 0], [-1.6, 0.1, -2.2]],
      [[0, 0, 0], [0.4, 0.9, 2.8]],
    ];
    return pts.map((p, idx) => ({ points: p, color: idx % 2 ? "#6366f1" : "#06b6d4" }));
  }, []);

  useFrame((state) => {
    if (lineRef.current) {
      lineRef.current.rotation.y = state.clock.elapsedTime * 0.02;
    }
  });

  return (
    <group ref={lineRef}>
      {lines.map((l, i) => (
        <Float key={i} speed={1.2} floatIntensity={0.5} rotationIntensity={0.2}>
          <Line
            points={l.points}
            color={l.color}
            lineWidth={1.2}
            transparent
            opacity={0.45}
          />
        </Float>
      ))}
    </group>
  );
}

/* ============ Central warehouse (stylized) ============ */
function Warehouse() {
  const group = useRef();
  useFrame((state) => {
    group.current.rotation.y = state.clock.elapsedTime * 0.12;
  });

  return (
    <group ref={group}>
      {/* Base platform */}
      <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1.6, 1.6, 0.12, 32]} />
        <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Core box */}
      <Float speed={1.4} rotationIntensity={0.15} floatIntensity={0.6}>
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[1.1, 0.9, 1.1]} />
          <meshStandardMaterial color="#2563eb" emissive="#2563eb" emissiveIntensity={0.35} metalness={0.5} roughness={0.3} />
        </mesh>
      </Float>
      {/* Floating boxes around */}
      {[[0.8, 0.4, 0.4], [-0.8, 0.7, -0.3], [0.3, 0.9, -0.8], [0.7, 0.15, -0.5]].map((p, i) => (
        <Float key={i} speed={2} rotationIntensity={0.6} floatIntensity={0.8}>
          <mesh position={p}>
            <boxGeometry args={[0.22, 0.22, 0.22]} />
            <meshStandardMaterial
              color={i % 2 ? "#a855f7" : "#06b6d4"}
              emissive={i % 2 ? "#a855f7" : "#06b6d4"}
              emissiveIntensity={0.5}
              metalness={0.4}
              roughness={0.4}
            />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

/* ============ Mouse parallax camera rig ============ */
function Rig() {
  useFrame((state) => {
    state.camera.position.x = THREE.MathUtils.lerp(state.camera.position.x, state.mouse.x * 0.6, 0.04);
    state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, 1.2 + state.mouse.y * 0.3, 0.04);
    state.camera.lookAt(0, 0.4, 0);
  });
  return null;
}

export default function Scene3D() {
  return (
    <div className="scene3d" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 1.4, 5.5], fov: 50 }}
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[4, 5, 4]} intensity={1.4} color="#6366f1" />
        <pointLight position={[-4, 3, -4]} intensity={1} color="#06b6d4" />
        <Suspense fallback={null}>
          <Warehouse />
          <Nodes />
          <Routes />
          <ContactShadows position={[0, -0.55, 0]} opacity={0.45} scale={6} blur={2.4} far={2} />
          <Rig />
        </Suspense>
      </Canvas>
    </div>
  );
}

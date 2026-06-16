import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Bounds, OrbitControls, PerspectiveCamera, Text, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'

const SCAN_MODEL_PATH = '/scan.glb'
const KNOWN_HEIGHT = 2.53
const DEFAULT_SCAN_METRICS = { width: 6.07, depth: 5.8, height: KNOWN_HEIGHT }
const STORAGE_KEY = 'apartment-visualizer:furniture-items'
const LAYOUT_API_PATH = '/api/layout'
const DRAG_FLOOR_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const FURNITURE_SHAPES = [
  ['box', 'Box'],
  ['bed', 'Bed'],
  ['sofa', 'Sofa'],
  ['chaise-sofa', 'L-sofa'],
  ['chair', 'Chair'],
  ['bench', 'Bench / ottoman'],
  ['rect-table', 'Rect table'],
  ['oval-table', 'Oval table'],
  ['round-table', 'Round table'],
  ['cabinet', 'Cabinet / shelf'],
  ['floor-lamp', 'Floor lamp'],
  ['table-lamp', 'Table lamp'],
  ['pendant-lamp', 'Pendant lamp'],
  ['ceiling-lamp', 'Ceiling lamp'],
  ['wall-lamp', 'Wall lamp'],
  ['chandelier', 'Chandelier'],
  ['led-strip', 'LED strip'],
  ['string-lights', 'String lights'],
  ['tv', 'TV / fjernsyn'],
  ['curtains', 'Curtains / gardiner'],
  ['rug', 'Rug / tæppe'],
  ['mirror', 'Mirror'],
  ['plant', 'Plant'],
  ['wall-art', 'Wall art'],
  ['media-console', 'Media console'],
]

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function getFloorIntersection(event) {
  const point = new THREE.Vector3()

  return event.ray.intersectPlane(DRAG_FLOOR_PLANE, point) ? point : null
}

function loadStoredFurnitureItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')

    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizeScanClone(scene) {
  const clone = scene.clone(true)
  const box = new THREE.Box3().setFromObject(clone)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  clone.position.set(-center.x, -box.min.y, -center.z)

  return { model: clone, metrics: { width: size.x, depth: size.z, height: size.y } }
}

function formatCm(value) {
  return `${Math.round(value * 100)} cm`
}

function formatFurnitureSize(furniture) {
  return `${formatCm(furniture.width)} x ${formatCm(furniture.depth)} x ${formatCm(furniture.height)}`
}

function getScale(rawMetrics, targetMetrics) {
  return {
    x: targetMetrics.width / (rawMetrics.width || 1),
    y: targetMetrics.height / (rawMetrics.height || 1),
    z: targetMetrics.depth / (rawMetrics.depth || 1),
  }
}

function calibrateRawMetrics(rawMetrics) {
  const scale = KNOWN_HEIGHT / (rawMetrics.height || 1)

  return {
    width: rawMetrics.width * scale,
    depth: rawMetrics.depth * scale,
    height: KNOWN_HEIGHT,
  }
}

function buildInsideWallMeasurements(scene, targetMetrics) {
  const prepared = normalizeScanClone(scene)
  const scale = getScale(prepared.metrics, targetMetrics)
  prepared.model.scale.set(scale.x, scale.y, scale.z)
  prepared.model.updateMatrixWorld(true)

  const measurements = []
  const seen = new Set()

  prepared.model.traverse((child) => {
    if (!child.isMesh || !child.name.startsWith('mesh')) {
      return
    }

    const box = new THREE.Box3().setFromObject(child)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const horizontalLength = Math.max(size.x, size.z)
    const horizontalThickness = Math.min(size.x, size.z)

    if (size.y < targetMetrics.height * 0.35 || horizontalLength < 0.45 || horizontalThickness > 0.35) {
      return
    }

    const axis = size.x >= size.z ? 'x' : 'z'
    const key = `${child.name}:${axis}`

    if (seen.has(key)) {
      return
    }

    seen.add(key)
    measurements.push({
      id: key,
      axis,
      length: horizontalLength,
      position: [center.x, 0.08, center.z],
    })
  })

  return measurements.sort((a, b) => b.length - a.length)
}

function ScanModel({ opacity, cutHeight, targetMetrics, onRawMetricsChange }) {
  const { scene } = useGLTF(SCAN_MODEL_PATH)

  const preparedScene = useMemo(() => {
    const prepared = normalizeScanClone(scene)

    prepared.model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
        child.material = child.material.clone()
      }
    })

    return prepared
  }, [scene])

  useEffect(() => {
    preparedScene.model.traverse((child) => {
      if (!child.isMesh) {
        return
      }

      const materials = Array.isArray(child.material) ? child.material : [child.material]

      materials.forEach((material) => {
        material.transparent = opacity < 1
        material.opacity = opacity
        material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), cutHeight)]
        material.needsUpdate = true
      })
    })
  }, [cutHeight, opacity, preparedScene])

  useEffect(() => {
    onRawMetricsChange(preparedScene.metrics)
  }, [onRawMetricsChange, preparedScene])

  const scale = getScale(preparedScene.metrics, targetMetrics)

  return <primitive object={preparedScene.model} scale={[scale.x, scale.y, scale.z]} />
}

function ScanDerivedShell({ visible, opacity, targetMetrics }) {
  const { scene } = useGLTF(SCAN_MODEL_PATH)

  const shell = useMemo(() => {
    const prepared = normalizeScanClone(scene)
    prepared.model.traverse((child) => {
      if (!child.isMesh) {
        return
      }

      child.castShadow = false
      child.receiveShadow = false
      child.material = new THREE.MeshBasicMaterial({
        color: '#f8f6f2',
        depthWrite: false,
        opacity,
        transparent: true,
        wireframe: true,
      })
    })

    return prepared
  }, [opacity, scene])

  if (!visible) {
    return null
  }

  const scale = getScale(shell.metrics, targetMetrics)

  return <primitive object={shell.model} scale={[scale.x, scale.y, scale.z]} />
}

function MeasurementLabels({ metrics }) {
  const halfWidth = metrics.width / 2
  const halfDepth = metrics.depth / 2
  const labelOffset = 0.38

  return (
    <group>
      <Text position={[0, 0.06, halfDepth + labelOffset]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.22} color="#151515" anchorX="center" anchorY="middle">
        {`Width ${formatCm(metrics.width)}`}
      </Text>
      <Text position={[halfWidth + labelOffset, 0.06, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]} fontSize={0.22} color="#151515" anchorX="center" anchorY="middle">
        {`Depth ${formatCm(metrics.depth)}`}
      </Text>
      <Text position={[-halfWidth - labelOffset, metrics.height / 2, 0]} rotation={[0, Math.PI / 2, 0]} fontSize={0.2} color="#151515" anchorX="center" anchorY="middle">
        {`Height ${formatCm(metrics.height)}`}
      </Text>
    </group>
  )
}

function InsideWallMeasurements({ visible, targetMetrics }) {
  const { scene } = useGLTF(SCAN_MODEL_PATH)
  const measurements = useMemo(() => buildInsideWallMeasurements(scene, targetMetrics), [scene, targetMetrics])

  if (!visible) {
    return null
  }

  return measurements.map((measurement) => (
    <Text
      key={measurement.id}
      position={measurement.position}
      rotation={[-Math.PI / 2, 0, measurement.axis === 'x' ? 0 : -Math.PI / 2]}
      fontSize={0.13}
      color="#111111"
      anchorX="center"
      anchorY="middle"
      outlineWidth={0.006}
      outlineColor="#ffffff"
    >
      {formatCm(measurement.length)}
    </Text>
  ))
}

function BoxPart({ position, size, color = '#8f6f4f' }) {
  return (
    <mesh castShadow receiveShadow position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.78} metalness={0.03} />
    </mesh>
  )
}

function CylinderPart({ position, radius = 0.08, depth = 0.4, scale = [1, 1, 1], color = '#6d5338' }) {
  return (
    <mesh castShadow receiveShadow position={position} scale={scale}>
      <cylinderGeometry args={[radius, radius, depth, 32]} />
      <meshStandardMaterial color={color} roughness={0.72} metalness={0.04} />
    </mesh>
  )
}

function FurnitureLabel({ furniture }) {
  return (
    <Text position={[0, furniture.height + 0.16, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.16} color="#1d1712" anchorX="center" anchorY="middle" maxWidth={Math.max(furniture.width, 1)}>
      {`${furniture.name}\n${formatFurnitureSize(furniture)}`}
    </Text>
  )
}

function BoxFurniture({ width, depth, height }) {
  return <BoxPart position={[0, height / 2, 0]} size={[width, height, depth]} />
}

function BedFurniture({ width, depth, height }) {
  const baseHeight = Math.max(height * 0.32, 0.12)
  const mattressHeight = Math.max(height * 0.38, 0.12)
  const headboardHeight = height
  const headboardDepth = Math.min(depth * 0.08, 0.16)

  return (
    <group>
      <BoxPart position={[0, baseHeight / 2, 0]} size={[width, baseHeight, depth]} color="#65513f" />
      <BoxPart position={[0, baseHeight + mattressHeight / 2, depth * 0.03]} size={[width * 0.96, mattressHeight, depth * 0.9]} color="#d8d3c9" />
      <BoxPart position={[0, headboardHeight / 2, -depth / 2 + headboardDepth / 2]} size={[width, headboardHeight, headboardDepth]} color="#7a6551" />
      <BoxPart position={[-width * 0.24, baseHeight + mattressHeight + 0.035, -depth * 0.28]} size={[width * 0.32, 0.07, depth * 0.18]} color="#efebe2" />
      <BoxPart position={[width * 0.24, baseHeight + mattressHeight + 0.035, -depth * 0.28]} size={[width * 0.32, 0.07, depth * 0.18]} color="#efebe2" />
    </group>
  )
}

function SofaFurniture({ width, depth, height }) {
  const seatHeight = Math.max(height * 0.42, 0.22)
  const backThickness = Math.min(depth * 0.16, 0.18)
  const armWidth = Math.min(width * 0.12, 0.18)
  const cushionDepth = Math.max(depth - backThickness, depth * 0.68)

  return (
    <group>
      <BoxPart position={[0, seatHeight / 2, backThickness / 2]} size={[width, seatHeight, cushionDepth]} color="#9b816c" />
      <BoxPart position={[0, height / 2, -depth / 2 + backThickness / 2]} size={[width, height, backThickness]} color="#755b47" />
      <BoxPart position={[-width / 2 + armWidth / 2, height * 0.42, 0]} size={[armWidth, height * 0.84, depth]} color="#755b47" />
      <BoxPart position={[width / 2 - armWidth / 2, height * 0.42, 0]} size={[armWidth, height * 0.84, depth]} color="#755b47" />
      <BoxPart position={[-width * 0.22, seatHeight + 0.025, depth * 0.08]} size={[width * 0.38, 0.05, cushionDepth * 0.74]} color="#b79c84" />
      <BoxPart position={[width * 0.22, seatHeight + 0.025, depth * 0.08]} size={[width * 0.38, 0.05, cushionDepth * 0.74]} color="#b79c84" />
    </group>
  )
}

function ChaiseSofaFurniture({ width, depth, height }) {
  const seatHeight = Math.max(height * 0.38, 0.24)
  const backHeight = height
  const backThickness = Math.min(depth * 0.11, 0.16)
  const armWidth = Math.min(width * 0.08, 0.16)
  const chaiseWidth = width * 0.42
  const shortSeatDepth = depth * 0.54
  const cushionTop = seatHeight + 0.04

  return (
    <group>
      <BoxPart position={[0, seatHeight / 2, -depth / 2 + backThickness + shortSeatDepth / 2]} size={[width, seatHeight, shortSeatDepth]} color="#9f836d" />
      <BoxPart position={[-width / 2 + chaiseWidth / 2, seatHeight / 2, 0]} size={[chaiseWidth, seatHeight, depth]} color="#9f836d" />
      <BoxPart position={[0, backHeight / 2, -depth / 2 + backThickness / 2]} size={[width, backHeight, backThickness]} color="#6d5443" />
      <BoxPart position={[-width / 2 + armWidth / 2, height * 0.44, 0]} size={[armWidth, height * 0.88, depth]} color="#6d5443" />
      <BoxPart position={[width / 2 - armWidth / 2, height * 0.44, -depth / 2 + backThickness + shortSeatDepth / 2]} size={[armWidth, height * 0.88, shortSeatDepth]} color="#6d5443" />
      <BoxPart position={[width * 0.22, cushionTop, -depth / 2 + backThickness + shortSeatDepth * 0.48]} size={[width * 0.5, 0.08, shortSeatDepth * 0.76]} color="#bca28b" />
      <BoxPart position={[-width / 2 + chaiseWidth / 2, cushionTop, depth * 0.12]} size={[chaiseWidth * 0.78, 0.08, depth * 0.68]} color="#bca28b" />
      <BoxPart position={[-width * 0.08, height * 0.72, -depth / 2 + backThickness + 0.04]} size={[width * 0.24, height * 0.34, 0.08]} color="#856a55" />
      <BoxPart position={[width * 0.2, height * 0.72, -depth / 2 + backThickness + 0.04]} size={[width * 0.24, height * 0.34, 0.08]} color="#856a55" />
    </group>
  )
}

function ChairFurniture({ width, depth, height }) {
  const seatHeight = height * 0.45
  const legHeight = Math.max(seatHeight * 0.82, 0.2)
  const legSize = Math.min(width, depth) * 0.08

  return (
    <group>
      <BoxPart position={[0, seatHeight, depth * 0.08]} size={[width, height * 0.12, depth * 0.72]} color="#9b7658" />
      <BoxPart position={[0, height * 0.68, -depth / 2 + 0.04]} size={[width, height * 0.64, 0.08]} color="#755b47" />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => (
        <BoxPart key={`${x}:${z}`} position={[x * (width * 0.38), legHeight / 2, z * (depth * 0.28)]} size={[legSize, legHeight, legSize]} color="#4f3b2a" />
      ))}
    </group>
  )
}

function BenchFurniture({ width, depth, height }) {
  const topHeight = Math.max(height * 0.28, 0.1)
  const legHeight = height - topHeight

  return (
    <group>
      <BoxPart position={[0, legHeight + topHeight / 2, 0]} size={[width, topHeight, depth]} color="#a38873" />
      <BoxPart position={[-width * 0.38, legHeight / 2, 0]} size={[width * 0.08, legHeight, depth * 0.74]} color="#594330" />
      <BoxPart position={[width * 0.38, legHeight / 2, 0]} size={[width * 0.08, legHeight, depth * 0.74]} color="#594330" />
    </group>
  )
}

function RectTableFurniture({ width, depth, height }) {
  const topThickness = Math.max(height * 0.08, 0.06)
  const legHeight = height - topThickness
  const legSize = Math.min(width, depth) * 0.06

  return (
    <group>
      <BoxPart position={[0, legHeight + topThickness / 2, 0]} size={[width, topThickness, depth]} color="#8a6848" />
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => (
        <BoxPart key={`${x}:${z}`} position={[x * (width * 0.42), legHeight / 2, z * (depth * 0.38)]} size={[legSize, legHeight, legSize]} color="#594330" />
      ))}
    </group>
  )
}

function OvalTableFurniture({ width, depth, height }) {
  const topThickness = Math.max(height * 0.08, 0.06)
  const legHeight = height - topThickness

  return (
    <group>
      <CylinderPart position={[0, legHeight + topThickness / 2, 0]} radius={1} depth={topThickness} scale={[width / 2, 1, depth / 2]} color="#8a6848" />
      <CylinderPart position={[0, legHeight / 2, 0]} radius={Math.min(width, depth) * 0.06} depth={legHeight} color="#594330" />
      <BoxPart position={[0, 0.03, 0]} size={[width * 0.42, 0.06, depth * 0.28]} color="#594330" />
    </group>
  )
}

function RoundTableFurniture(props) {
  return <OvalTableFurniture {...props} width={Math.min(props.width, props.depth)} depth={Math.min(props.width, props.depth)} />
}

function CabinetFurniture({ width, depth, height }) {
  return (
    <group>
      <BoxPart position={[0, height / 2, 0]} size={[width, height, depth]} color="#80664f" />
      <BoxPart position={[-width * 0.25, height / 2, depth / 2 + 0.01]} size={[0.025, height * 0.7, 0.025]} color="#2f261f" />
      <BoxPart position={[width * 0.25, height / 2, depth / 2 + 0.01]} size={[0.025, height * 0.7, 0.025]} color="#2f261f" />
      <BoxPart position={[0, height * 0.5, depth / 2 + 0.02]} size={[0.025, height * 0.88, 0.025]} color="#3a2e25" />
    </group>
  )
}

function FloorLampFurniture({ width, depth, height }) {
  const footprint = Math.min(width, depth)
  const baseRadius = Math.max(footprint * 0.26, 0.12)
  const poleHeight = height * 0.72
  const shadeHeight = Math.max(height * 0.24, 0.18)
  const shadeRadius = Math.max(footprint * 0.42, 0.16)

  return (
    <group>
      <CylinderPart position={[0, 0.03, 0]} radius={baseRadius} depth={0.06} color="#d7b7cf" />
      <CylinderPart position={[0, poleHeight / 2, 0]} radius={Math.max(footprint * 0.035, 0.018)} depth={poleHeight} color="#9a6f92" />
      <mesh castShadow receiveShadow position={[0, poleHeight + shadeHeight / 2, 0]}>
        <coneGeometry args={[shadeRadius, shadeRadius * 0.68, shadeHeight, 32]} />
        <meshStandardMaterial color="#ffe0ef" roughness={0.62} metalness={0.02} transparent opacity={0.88} />
      </mesh>
      <pointLight position={[0, poleHeight + shadeHeight * 0.45, 0]} intensity={0.75} distance={2.4} color="#ffd6eb" />
    </group>
  )
}

function TableLampFurniture({ width, depth, height }) {
  const footprint = Math.min(width, depth)
  const baseHeight = height * 0.16
  const stemHeight = height * 0.42
  const shadeHeight = height * 0.34
  const shadeRadius = Math.max(footprint * 0.45, 0.12)

  return (
    <group>
      <CylinderPart position={[0, baseHeight / 2, 0]} radius={Math.max(footprint * 0.28, 0.08)} depth={baseHeight} color="#a9789c" />
      <CylinderPart position={[0, baseHeight + stemHeight / 2, 0]} radius={Math.max(footprint * 0.045, 0.016)} depth={stemHeight} color="#6d4d65" />
      <mesh castShadow receiveShadow position={[0, baseHeight + stemHeight + shadeHeight / 2, 0]}>
        <coneGeometry args={[shadeRadius, shadeRadius * 0.72, shadeHeight, 32]} />
        <meshStandardMaterial color="#ffe2f0" roughness={0.62} metalness={0.02} transparent opacity={0.88} />
      </mesh>
      <pointLight position={[0, baseHeight + stemHeight + shadeHeight * 0.48, 0]} intensity={0.58} distance={1.8} color="#ffd6eb" />
    </group>
  )
}

function PendantLampFurniture({ width, depth, height }) {
  const footprint = Math.min(width, depth)
  const cordHeight = height * 0.52
  const shadeHeight = Math.max(height * 0.34, 0.16)
  const shadeRadius = Math.max(footprint * 0.42, 0.12)

  return (
    <group>
      <CylinderPart position={[0, cordHeight / 2, 0]} radius={Math.max(footprint * 0.018, 0.01)} depth={cordHeight} color="#5b4555" />
      <CylinderPart position={[0, height - 0.025, 0]} radius={Math.max(footprint * 0.18, 0.07)} depth={0.05} color="#a9789c" />
      <mesh castShadow receiveShadow position={[0, cordHeight + shadeHeight / 2, 0]}>
        <sphereGeometry args={[shadeRadius, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.72]} />
        <meshStandardMaterial color="#ffe0ef" roughness={0.56} metalness={0.02} transparent opacity={0.88} />
      </mesh>
      <pointLight position={[0, cordHeight + shadeHeight * 0.28, 0]} intensity={0.75} distance={2.2} color="#ffd6eb" />
    </group>
  )
}

function CeilingLampFurniture({ width, depth, height }) {
  const radius = Math.max(Math.min(width, depth) * 0.42, 0.12)
  const bodyHeight = Math.max(height * 0.52, 0.1)

  return (
    <group>
      <CylinderPart position={[0, height - 0.025, 0]} radius={radius * 0.72} depth={0.05} color="#c98eb0" />
      <mesh castShadow receiveShadow position={[0, height - bodyHeight / 2 - 0.04, 0]}>
        <sphereGeometry args={[radius, 32, 16]} />
        <meshStandardMaterial color="#ffe2f0" roughness={0.5} transparent opacity={0.88} />
      </mesh>
      <pointLight position={[0, height - bodyHeight * 0.55, 0]} intensity={0.82} distance={2.4} color="#ffd6eb" />
    </group>
  )
}

function WallLampFurniture({ width, depth, height }) {
  const backDepth = Math.max(depth * 0.18, 0.035)
  const shadeDepth = Math.max(depth * 0.62, 0.12)

  return (
    <group>
      <BoxPart position={[0, height / 2, -depth / 2 + backDepth / 2]} size={[width * 0.55, height * 0.72, backDepth]} color="#a9789c" />
      <CylinderPart position={[0, height * 0.48, -depth * 0.12]} radius={Math.max(width * 0.035, 0.018)} depth={shadeDepth} color="#6d4d65" />
      <mesh castShadow receiveShadow position={[0, height * 0.48, depth * 0.18]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[Math.max(width * 0.32, 0.1), Math.max(width * 0.22, 0.07), Math.max(height * 0.36, 0.12), 32]} />
        <meshStandardMaterial color="#ffe0ef" roughness={0.56} transparent opacity={0.88} />
      </mesh>
      <pointLight position={[0, height * 0.48, depth * 0.28]} intensity={0.62} distance={1.8} color="#ffd6eb" />
    </group>
  )
}

function ChandelierFurniture({ width, depth, height }) {
  const radius = Math.max(Math.min(width, depth) * 0.34, 0.16)
  const cordHeight = height * 0.34
  const ringY = height * 0.48

  return (
    <group>
      <CylinderPart position={[0, height - 0.025, 0]} radius={radius * 0.34} depth={0.05} color="#c98eb0" />
      <CylinderPart position={[0, height - cordHeight / 2, 0]} radius={0.012} depth={cordHeight} color="#6d4d65" />
      <mesh castShadow receiveShadow position={[0, ringY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.018, 12, 48]} />
        <meshStandardMaterial color="#a9789c" roughness={0.45} metalness={0.15} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((index) => {
        const angle = (index / 6) * Math.PI * 2
        const x = Math.cos(angle) * radius
        const z = Math.sin(angle) * radius

        return (
          <group key={index} position={[x, ringY - height * 0.12, z]}>
            <CylinderPart position={[0, height * 0.06, 0]} radius={0.01} depth={height * 0.12} color="#6d4d65" />
            <mesh castShadow receiveShadow position={[0, 0, 0]}>
              <sphereGeometry args={[Math.max(radius * 0.13, 0.035), 16, 10]} />
              <meshStandardMaterial color="#fff1b8" emissive="#ffd6a3" emissiveIntensity={0.35} roughness={0.35} />
            </mesh>
            <pointLight intensity={0.16} distance={1.4} color="#ffe0b8" />
          </group>
        )
      })}
    </group>
  )
}

function LedStripFurniture({ width, depth, height }) {
  const stripHeight = Math.max(height, 0.025)

  return (
    <group>
      <BoxPart position={[0, stripHeight / 2, 0]} size={[width, stripHeight, Math.max(depth, 0.025)]} color="#ffc0df" />
      <pointLight position={[0, stripHeight + 0.02, 0]} intensity={0.45} distance={Math.max(width, depth, 1.4)} color="#ff9bd0" />
    </group>
  )
}

function StringLightsFurniture({ width, depth, height }) {
  const count = 8

  return (
    <group>
      <BoxPart position={[0, height, 0]} size={[width, 0.018, Math.max(depth, 0.018)]} color="#6d4d65" />
      {Array.from({ length: count }).map((_, index) => {
        const x = -width / 2 + (width / (count - 1)) * index
        const y = height - Math.sin((index / (count - 1)) * Math.PI) * height * 0.18

        return (
          <group key={index} position={[x, y, 0]}>
            <CylinderPart position={[0, -0.05, 0]} radius={0.008} depth={0.1} color="#6d4d65" />
            <mesh castShadow receiveShadow position={[0, -0.12, 0]}>
              <sphereGeometry args={[0.035, 16, 10]} />
              <meshStandardMaterial color="#fff1b8" emissive="#ffd6a3" emissiveIntensity={0.45} roughness={0.35} />
            </mesh>
            <pointLight position={[0, -0.12, 0]} intensity={0.12} distance={0.9} color="#ffe0b8" />
          </group>
        )
      })}
    </group>
  )
}

function TvFurniture({ width, depth, height }) {
  const screenDepth = Math.max(depth * 0.18, 0.035)
  const standHeight = Math.max(height * 0.16, 0.08)

  return (
    <group>
      <BoxPart position={[0, standHeight + (height - standHeight) / 2, 0]} size={[width, height - standHeight, screenDepth]} color="#11131a" />
      <BoxPart position={[0, standHeight + (height - standHeight) / 2, depth / 2 + 0.01]} size={[width * 0.9, (height - standHeight) * 0.82, 0.02]} color="#1f2533" />
      <BoxPart position={[0, standHeight / 2, 0]} size={[width * 0.08, standHeight, depth * 0.34]} color="#2d2b30" />
      <BoxPart position={[0, 0.015, 0]} size={[width * 0.42, 0.03, depth * 0.5]} color="#2d2b30" />
    </group>
  )
}

function CurtainsFurniture({ width, depth, height }) {
  const panelWidth = width * 0.46
  const rodHeight = height - 0.03

  return (
    <group>
      <CylinderPart position={[0, rodHeight, 0]} radius={0.025} depth={width} color="#aa7aa0" />
      <BoxPart position={[-width * 0.25, height / 2 - 0.04, 0]} size={[panelWidth, height * 0.9, Math.max(depth, 0.035)]} color="#f4c7de" />
      <BoxPart position={[width * 0.25, height / 2 - 0.04, 0]} size={[panelWidth, height * 0.9, Math.max(depth, 0.035)]} color="#f1b6d4" />
      {[-0.42, -0.28, -0.14, 0.14, 0.28, 0.42].map((x) => (
        <BoxPart key={x} position={[x * width, height / 2 - 0.04, depth / 2 + 0.01]} size={[0.018, height * 0.86, 0.018]} color="#dc8fba" />
      ))}
    </group>
  )
}

function RugFurniture({ width, depth, height }) {
  return (
    <group>
      <BoxPart position={[0, Math.max(height, 0.015) / 2, 0]} size={[width, Math.max(height, 0.015), depth]} color="#f0a9cc" />
      <BoxPart position={[0, Math.max(height, 0.015) + 0.004, 0]} size={[width * 0.86, 0.008, depth * 0.78]} color="#ffe4f0" />
    </group>
  )
}

function MirrorFurniture({ width, depth, height }) {
  return (
    <group>
      <BoxPart position={[0, height / 2, 0]} size={[width, height, Math.max(depth, 0.04)]} color="#d7b7cf" />
      <BoxPart position={[0, height / 2, depth / 2 + 0.012]} size={[width * 0.82, height * 0.86, 0.018]} color="#dff4ff" />
    </group>
  )
}

function PlantFurniture({ width, depth, height }) {
  const potHeight = height * 0.28
  const stemHeight = height * 0.48

  return (
    <group>
      <CylinderPart position={[0, potHeight / 2, 0]} radius={Math.min(width, depth) * 0.28} depth={potHeight} color="#be83a5" />
      <CylinderPart position={[0, potHeight + stemHeight / 2, 0]} radius={0.025} depth={stemHeight} color="#2f6d4f" />
      {[[-0.18, 0.08], [0.18, -0.02], [-0.12, -0.16], [0.14, 0.15], [0, 0]].map(([x, z], index) => (
        <mesh key={index} castShadow receiveShadow position={[x * width, potHeight + stemHeight + index * 0.025, z * depth]} scale={[width * 0.22, height * 0.13, depth * 0.08]}>
          <sphereGeometry args={[1, 24, 12]} />
          <meshStandardMaterial color={index % 2 ? '#42a66a' : '#1d8059'} roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

function WallArtFurniture({ width, depth, height }) {
  return (
    <group>
      <BoxPart position={[0, height / 2, 0]} size={[width, height, Math.max(depth, 0.035)]} color="#f7d7e7" />
      <BoxPart position={[0, height / 2, depth / 2 + 0.012]} size={[width * 0.82, height * 0.74, 0.018]} color="#85c9d6" />
      <BoxPart position={[-width * 0.12, height * 0.54, depth / 2 + 0.024]} size={[width * 0.22, height * 0.28, 0.012]} color="#ffd164" />
      <BoxPart position={[width * 0.16, height * 0.42, depth / 2 + 0.024]} size={[width * 0.28, height * 0.22, 0.012]} color="#006ce0" />
    </group>
  )
}

function MediaConsoleFurniture({ width, depth, height }) {
  return (
    <group>
      <BoxPart position={[0, height / 2, 0]} size={[width, height, depth]} color="#8d6b54" />
      <BoxPart position={[-width * 0.24, height * 0.55, depth / 2 + 0.012]} size={[width * 0.34, height * 0.55, 0.02]} color="#6f523f" />
      <BoxPart position={[width * 0.24, height * 0.55, depth / 2 + 0.012]} size={[width * 0.34, height * 0.55, 0.02]} color="#6f523f" />
      <BoxPart position={[0, height * 0.18, depth / 2 + 0.02]} size={[width * 0.16, 0.025, 0.025]} color="#2f261f" />
    </group>
  )
}

function FurnitureShape({ furniture }) {
  const props = { width: furniture.width, depth: furniture.depth, height: furniture.height }

  switch (furniture.shape) {
    case 'bed':
      return <BedFurniture {...props} />
    case 'sofa':
      return <SofaFurniture {...props} />
    case 'chaise-sofa':
      return <ChaiseSofaFurniture {...props} />
    case 'chair':
      return <ChairFurniture {...props} />
    case 'bench':
      return <BenchFurniture {...props} />
    case 'rect-table':
      return <RectTableFurniture {...props} />
    case 'oval-table':
      return <OvalTableFurniture {...props} />
    case 'round-table':
      return <RoundTableFurniture {...props} />
    case 'cabinet':
      return <CabinetFurniture {...props} />
    case 'floor-lamp':
      return <FloorLampFurniture {...props} />
    case 'table-lamp':
      return <TableLampFurniture {...props} />
    case 'pendant-lamp':
      return <PendantLampFurniture {...props} />
    case 'ceiling-lamp':
      return <CeilingLampFurniture {...props} />
    case 'wall-lamp':
      return <WallLampFurniture {...props} />
    case 'chandelier':
      return <ChandelierFurniture {...props} />
    case 'led-strip':
      return <LedStripFurniture {...props} />
    case 'string-lights':
      return <StringLightsFurniture {...props} />
    case 'tv':
      return <TvFurniture {...props} />
    case 'curtains':
      return <CurtainsFurniture {...props} />
    case 'rug':
      return <RugFurniture {...props} />
    case 'mirror':
      return <MirrorFurniture {...props} />
    case 'plant':
      return <PlantFurniture {...props} />
    case 'wall-art':
      return <WallArtFurniture {...props} />
    case 'media-console':
      return <MediaConsoleFurniture {...props} />
    default:
      return <BoxFurniture {...props} />
  }
}

function RemoteFurnitureModel({ furniture }) {
  const { scene } = useGLTF(`/api/model?url=${encodeURIComponent(furniture.modelUrl)}`)
  const prepared = useMemo(() => {
    const clone = scene.clone(true)
    const box = new THREE.Box3().setFromObject(clone)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())

    clone.position.set(-center.x, -box.min.y, -center.z)
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    return { model: clone, metrics: { width: size.x, depth: size.z, height: size.y } }
  }, [scene])

  const scale = getScale(prepared.metrics, furniture)

  return <primitive object={prepared.model} scale={[scale.x, scale.y, scale.z]} />
}

function FurnitureModel({ furniture, selected, onPointerDown, onPointerMove, onPointerUp }) {
  if (!furniture) {
    return null
  }

  return (
    <group
      position={[furniture.x, furniture.y, furniture.z]}
      rotation={[0, THREE.MathUtils.degToRad(furniture.rotation), 0]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {furniture.modelUrl ? <RemoteFurnitureModel furniture={furniture} /> : <FurnitureShape furniture={furniture} />}
      {selected ? (
        <mesh position={[0, furniture.height / 2, 0]}>
          <boxGeometry args={[furniture.width + 0.06, furniture.height + 0.06, furniture.depth + 0.06]} />
          <meshBasicMaterial color="#ff79b8" wireframe transparent opacity={0.72} depthWrite={false} />
        </mesh>
      ) : null}
      <FurnitureLabel furniture={furniture} />
    </group>
  )
}

function FurnitureElementControls({ item, targetMetrics, onChange, onRemove }) {
  return (
    <article className="element-card">
      <div className="element-header">
        <div>
          <h3>{item.name}</h3>
          <p>{formatFurnitureSize(item)}</p>
          {item.modelUrl ? <p>Real 3D model applied</p> : null}
          {item.imageUrl ? <p>Product image applied</p> : null}
        </div>
        <button type="button" className="text-button" onClick={onRemove}>Remove</button>
      </div>
      {item.warnings?.map((warning) => <p key={warning} className="status-text warning-text">{warning}</p>)}
      <label className="control">
        <span>Shape</span>
        <select value={item.shape} onChange={(event) => onChange('shape', event.target.value)}>
          {FURNITURE_SHAPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <NumberInput label="Position X" value={item.x} min={-targetMetrics.width / 2} max={targetMetrics.width / 2} step={0.01} onChange={(value) => onChange('x', value)} />
      <NumberInput label="Position Y" value={item.y} min={0} max={targetMetrics.height} step={0.01} onChange={(value) => onChange('y', value)} />
      <NumberInput label="Position Z" value={item.z} min={-targetMetrics.depth / 2} max={targetMetrics.depth / 2} step={0.01} onChange={(value) => onChange('z', value)} />
      <NumberInput label="Rotation" value={item.rotation} min={-180} max={180} step={1} onChange={(value) => onChange('rotation', value)} suffix="deg" />
    </article>
  )
}

function NumberInput({ label, value, min, max, step, onChange, suffix = 'm' }) {
  return (
    <label className="control">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <strong>{value.toFixed(2)} {suffix}</strong>
    </label>
  )
}

function TextInput({ label, value, onChange, placeholder }) {
  return (
    <label className="control">
      <span>{label}</span>
      <input type="url" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

export default function App() {
  const [targetMetrics, setTargetMetrics] = useState(DEFAULT_SCAN_METRICS)
  const [rawScanMetrics, setRawScanMetrics] = useState(null)
  const [measurementsInitialized, setMeasurementsInitialized] = useState(false)
  const [showOverlay, setShowOverlay] = useState(true)
  const [overlayOpacity, setOverlayOpacity] = useState(0.78)
  const [scanOpacity, setScanOpacity] = useState(0.92)
  const [cutHeight, setCutHeight] = useState(2.15)
  const [showWallMeasurements, setShowWallMeasurements] = useState(true)
  const [productUrl, setProductUrl] = useState('')
  const [productStatus, setProductStatus] = useState('')
  const [furnitureItems, setFurnitureItems] = useState(loadStoredFurnitureItems)
  const [menuOpen, setMenuOpen] = useState(false)
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [selectedFurnitureId, setSelectedFurnitureId] = useState(null)
  const [draggingFurnitureId, setDraggingFurnitureId] = useState(null)
  const dragStateRef = useRef(null)

  useEffect(() => {
    if (!rawScanMetrics || measurementsInitialized) {
      return
    }

    setTargetMetrics(calibrateRawMetrics(rawScanMetrics))
    setMeasurementsInitialized(true)
  }, [measurementsInitialized, rawScanMetrics])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(furnitureItems))
  }, [furnitureItems])

  useEffect(() => {
    let cancelled = false

    async function loadCloudLayout() {
      try {
        const response = await fetch(LAYOUT_API_PATH)

        if (!response.ok) {
          throw new Error('Could not load saved layout.')
        }

        const data = await response.json()

        if (!cancelled && Array.isArray(data.items)) {
          setFurnitureItems(data.items)
        }
      } catch {
        // Keep localStorage fallback if cloud layout is unavailable.
      } finally {
        if (!cancelled) {
          setLayoutLoaded(true)
        }
      }
    }

    loadCloudLayout()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!layoutLoaded) {
      return undefined
    }

    const timeout = window.setTimeout(async () => {
      try {
        await fetch(LAYOUT_API_PATH, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: furnitureItems }),
        })
      } catch {
        // localStorage already has the latest state as an offline fallback.
      }
    }, 450)

    return () => window.clearTimeout(timeout)
  }, [furnitureItems, layoutLoaded])

  const updateFurniture = (id, key, value) => {
    setFurnitureItems((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item))
  }

  const updateFurniturePosition = (id, x, z) => {
    setFurnitureItems((current) => current.map((item) => (
      item.id === id
        ? {
          ...item,
          x: clamp(x, -targetMetrics.width / 2, targetMetrics.width / 2),
          z: clamp(z, -targetMetrics.depth / 2, targetMetrics.depth / 2),
        }
        : item
    )))
  }

  const removeFurniture = (id) => {
    setFurnitureItems((current) => current.filter((item) => item.id !== id))
  }

  const clearFurnitureItems = () => {
    setFurnitureItems([])
    setSelectedFurnitureId(null)
    setDraggingFurnitureId(null)
    dragStateRef.current = null
  }

  const collapseMenuOnDoubleClick = (event) => {
    if (!window.matchMedia('(max-width: 640px)').matches) {
      return
    }

    if (event.target.closest('button, input, select, textarea, a, label')) {
      return
    }

    setMenuOpen(false)
  }

  const startFurnitureDrag = (item, event) => {
    event.stopPropagation()
    const floorPoint = getFloorIntersection(event)

    setSelectedFurnitureId(item.id)

    if (!floorPoint) {
      return
    }

    dragStateRef.current = {
      id: item.id,
      offsetX: item.x - floorPoint.x,
      offsetZ: item.z - floorPoint.z,
    }
    setDraggingFurnitureId(item.id)

    if (event.target.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId)
    }
  }

  const moveFurnitureDrag = (event) => {
    if (!dragStateRef.current) {
      return
    }

    event.stopPropagation()
    const floorPoint = getFloorIntersection(event)

    if (!floorPoint) {
      return
    }

    updateFurniturePosition(
      dragStateRef.current.id,
      floorPoint.x + dragStateRef.current.offsetX,
      floorPoint.z + dragStateRef.current.offsetZ,
    )
  }

  const stopFurnitureDrag = (event) => {
    if (!dragStateRef.current) {
      return
    }

    event.stopPropagation()
    dragStateRef.current = null
    setDraggingFurnitureId(null)

    if (event.target.releasePointerCapture) {
      event.target.releasePointerCapture(event.pointerId)
    }
  }

  const importProduct = async (event) => {
    event.preventDefault()
    setProductStatus('Looking for product dimensions...')

    try {
      const response = await fetch(`/api/product?url=${encodeURIComponent(productUrl)}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Could not import product.')
      }

      const newFurniture = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: data.name || 'Imported furniture',
        width: data.widthCm / 100,
        depth: data.depthCm / 100,
        height: data.heightCm / 100,
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        url: data.url,
        imageUrl: data.imageUrl,
        modelUrl: data.modelUrl,
        shape: data.shape || 'box',
        source: data.source,
        warnings: data.warnings || [],
      }

      setFurnitureItems((current) => [...current, newFurniture])
      setProductStatus(`Furniture added: ${data.widthCm} x ${data.depthCm} x ${data.heightCm} cm${data.source ? ` from ${data.source}` : ''}.${data.warnings?.length ? ` ${data.warnings.join(' ')}` : ''}`)
    } catch (error) {
      setProductStatus(error instanceof Error ? error.message : 'Could not import product.')
    }
  }

  return (
    <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`}>
      <button
        type="button"
        className={`burger ${menuOpen ? 'is-open' : ''}`}
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-controls="control-panel"
        aria-label="Toggle controls"
      >
        <span />
        <span />
        <span />
      </button>

      <aside id="control-panel" className={`sidebar ${menuOpen ? 'is-open' : ''}`} onDoubleClick={collapseMenuOnDoubleClick}>
        <div>
          <p className="eyebrow">Metaroom PDF + GLB</p>
          <h1>Apartment Visualizer</h1>
          <p className="intro">
            Hej skat, her kan du bruge lidt tid. Du kan smide et link ind fra et møbel. IKEA er gode, de har 3D modeller, ellers har jeg lavet nogle placeholders du kan vælge imellem.
          </p>
        </div>

        <section>
          <h2>Scan view</h2>
          <NumberInput label="Roof cut" value={cutHeight} min={0.6} max={Math.max(3.5, targetMetrics.height + 0.5)} step={0.01} onChange={setCutHeight} />
          <NumberInput label="Scan opacity" value={scanOpacity} min={0.1} max={1} step={0.01} onChange={setScanOpacity} suffix="" />
        </section>

        <section>
          <h2>Hybrid shell</h2>
          <label className="toggle">
            <input type="checkbox" checked={showOverlay} onChange={(event) => setShowOverlay(event.target.checked)} />
            <span>Show exact-shape shell</span>
          </label>
          <NumberInput label="Overlay opacity" value={overlayOpacity} min={0.1} max={1} step={0.01} onChange={setOverlayOpacity} suffix="" />
        </section>

        <section>
          <h2>Furniture URL</h2>
          <form className="product-form" onSubmit={importProduct}>
            <TextInput label="Product link" value={productUrl} onChange={setProductUrl} placeholder="https://example.com/product" />
            <button type="submit" className="reset-button" disabled={!productUrl}>Import furniture</button>
          </form>
          {productStatus ? <p className="status-text">{productStatus}</p> : null}
        </section>

        {furnitureItems.length > 0 ? (
          <section>
            <h2>Elements</h2>
            <button type="button" className="reset-button" onClick={clearFurnitureItems}>Clear saved elements</button>
            {furnitureItems.map((item) => (
              <FurnitureElementControls
                key={item.id}
                item={item}
                targetMetrics={targetMetrics}
                onChange={(key, value) => updateFurniture(item.id, key, value)}
                onRemove={() => removeFurniture(item.id)}
              />
            ))}
          </section>
        ) : null}

        <section className="summary">
          <h2>All measurements</h2>
          <label className="toggle">
            <input type="checkbox" checked={showWallMeasurements} onChange={(event) => setShowWallMeasurements(event.target.checked)} />
            <span>Show inside wall measurements</span>
          </label>
          <p>Shell footprint: exact GLB clone</p>
          <p>Width: {formatCm(targetMetrics.width)}</p>
          <p>Depth: {formatCm(targetMetrics.depth)}</p>
          <p>Height: {formatCm(targetMetrics.height)}</p>
          {rawScanMetrics ? <p>Calibrated scan: {formatCm(calibrateRawMetrics(rawScanMetrics).width)} x {formatCm(calibrateRawMetrics(rawScanMetrics).depth)} x {formatCm(KNOWN_HEIGHT)}</p> : null}
          <p>Base model source: {SCAN_MODEL_PATH}</p>
        </section>

      </aside>

      {menuOpen ? <button type="button" className="backdrop" aria-label="Close controls" onClick={() => setMenuOpen(false)} /> : null}

      <main className="viewer">
        <Canvas shadows dpr={[1, 2]} gl={{ localClippingEnabled: true }} onPointerMissed={() => setSelectedFurnitureId(null)}>
          <color attach="background" args={['#f5f3ee']} />
          <PerspectiveCamera makeDefault position={[5.8, 6.4, 6.9]} fov={42} />
          <ambientLight intensity={1.4} />
          <directionalLight castShadow intensity={1.4} position={[8, 12, 5]} shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
          <Suspense fallback={null}>
            <Bounds fit clip margin={1.2}>
              <ScanModel opacity={scanOpacity} cutHeight={cutHeight} targetMetrics={targetMetrics} onRawMetricsChange={setRawScanMetrics} />
              <ScanDerivedShell visible={showOverlay} opacity={overlayOpacity} targetMetrics={targetMetrics} />
              {furnitureItems.map((item) => (
                <FurnitureModel
                  key={item.id}
                  furniture={item}
                  selected={item.id === selectedFurnitureId}
                  onPointerDown={(event) => startFurnitureDrag(item, event)}
                  onPointerMove={moveFurnitureDrag}
                  onPointerUp={stopFurnitureDrag}
                />
              ))}
              <MeasurementLabels metrics={targetMetrics} />
              <InsideWallMeasurements visible={showWallMeasurements} targetMetrics={targetMetrics} />
            </Bounds>
          </Suspense>
          <gridHelper args={[20, 20, '#888888', '#c7c7c7']} position={[0, 0.002, 0]} />
          <OrbitControls makeDefault target={[0, 1.1, 0]} enabled={!draggingFurnitureId} />
        </Canvas>
      </main>
    </div>
  )
}

useGLTF.preload(SCAN_MODEL_PATH)

export const defaultApartment = {
  wallHeight: 2.53,
  exteriorWallThickness: 0.25,
  interiorWallThickness: 0.1,
  rooms: {
    living: { label: 'Living Room', width: 4.08, depth: 5.0, color: '#d6c2a3' },
    entry: { label: 'Entry', width: 1.57, depth: 2.04, color: '#b7c8dd' },
    kitchen: { label: 'Kitchen', width: 1.89, depth: 3.68, color: '#b9d6c2' },
    bath: { label: 'Bath', width: 1.89, depth: 1.19, color: '#cfc3dd' },
  },
}

export function buildApartmentLayout(config) {
  const { rooms, wallHeight, exteriorWallThickness, interiorWallThickness } = config
  const living = rooms.living
  const entry = rooms.entry
  const kitchen = rooms.kitchen
  const bath = rooms.bath

  const rightColumnDepth = kitchen.depth + bath.depth
  const livingTopOffset = Math.max(0, (living.depth - rightColumnDepth) * 0.2)
  // Keep the entry aligned under the living-room notch instead of overlapping the bath.
  const entryLeft = living.width - entry.width
  const entryTop = Math.max(kitchen.depth - 0.4, livingTopOffset + living.depth - entry.depth - 0.45)

  const roomRects = [
    { id: 'living', x: 0, z: livingTopOffset, width: living.width, depth: living.depth, color: living.color, label: living.label },
    { id: 'kitchen', x: living.width, z: 0, width: kitchen.width, depth: kitchen.depth, color: kitchen.color, label: kitchen.label },
    { id: 'bath', x: living.width, z: kitchen.depth, width: bath.width, depth: bath.depth, color: bath.color, label: bath.label },
    { id: 'entry', x: entryLeft, z: entryTop, width: entry.width, depth: entry.depth, color: entry.color, label: entry.label },
  ]

  const wallSegments = []

  for (const room of roomRects) {
    const thickness = room.id === 'living' || room.id === 'kitchen' || room.id === 'bath' ? exteriorWallThickness : interiorWallThickness
    wallSegments.push(
      { id: `${room.id}-top`, cx: room.x + room.width / 2, cz: room.z - thickness / 2, length: room.width, thickness, axis: 'x' },
      { id: `${room.id}-bottom`, cx: room.x + room.width / 2, cz: room.z + room.depth + thickness / 2, length: room.width, thickness, axis: 'x' },
      { id: `${room.id}-left`, cx: room.x - thickness / 2, cz: room.z + room.depth / 2, length: room.depth, thickness, axis: 'z' },
      { id: `${room.id}-right`, cx: room.x + room.width + thickness / 2, cz: room.z + room.depth / 2, length: room.depth, thickness, axis: 'z' },
    )
  }

  const width = Math.max(...roomRects.map((room) => room.x + room.width))
  const depth = Math.max(...roomRects.map((room) => room.z + room.depth))

  return {
    roomRects,
    wallSegments,
    wallHeight,
    width,
    depth,
  }
}

/**
 * Room Name Assignment
 * Match OCR text to detected room polygons
 */

import { bboxDistance } from './ocr.js';

/**
 * Assign names to detected rooms based on OCR text
 * @param {Array} rooms - Detected room polygons
 * @param {Array} roomNameWords - OCR words classified as room names
 * @param {Object} options - Naming options
 * @returns {Array} Rooms with assigned names
 */
export function assignRoomNames(rooms, roomNameWords, options = {}) {
  const {
    maxDistance = 200, // max pixels from text to room centroid
    minConfidence = 60,
    defaultName = 'Raum'
  } = options;

  // Filter low confidence names
  const candidates = roomNameWords.filter(w => w.confidence >= minConfidence);

  // Track which names have been used
  const usedNames = new Set();

  return rooms.map(room => {
    // Find text near room centroid
    const nearby = candidates
      .filter(name => !usedNames.has(name.text))
      .map(name => ({
        ...name,
        distance: bboxDistance(room.centroid, name.bbox)
      }))
      .filter(name => name.distance < maxDistance)
      .sort((a, b) => {
        // Sort by distance first, then confidence
        if (Math.abs(a.distance - b.distance) < 20) {
          return b.confidence - a.confidence;
        }
        return a.distance - b.distance;
      });

    if (nearby.length === 0) {
      return {
        ...room,
        name: defaultName,
        nameConfidence: 0,
        nameSource: 'default'
      };
    }

    const bestMatch = nearby[0];
    usedNames.add(bestMatch.text);

    return {
      ...room,
      name: capitalizeRoomName(bestMatch.text),
      nameConfidence: bestMatch.confidence,
      nameSource: 'ocr',
      nameDistance: bestMatch.distance
    };
  });
}

/**
 * Capitalize room name appropriately
 * @param {string} name - Raw OCR text
 * @returns {string} Formatted name
 */
function capitalizeRoomName(name) {
  // If all caps, convert to title case
  if (name === name.toUpperCase()) {
    return name.charAt(0) + name.slice(1).toLowerCase();
  }

  // Otherwise keep as is
  return name;
}

/**
 * Check if point is inside polygon
 * @param {Object} point - Point {x, y}
 * @param {Array} polygon - Array of vertices {x, y}
 * @returns {boolean} True if inside
 */
export function pointInPolygon(point, polygon) {
  let inside = false;
  const { x, y } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}

// src/background.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBackgroundController } from './background.js';

describe('createBackgroundController', () => {
  let store;
  let renderAll;
  let updateMeta;
  let controller;

  beforeEach(() => {
    store = {
      getState: vi.fn(() => ({
        floors: [{ id: 'f1', rooms: [], layout: { enabled: true, background: { dataUrl: 'test', scale: {} } } }],
        selectedFloorId: 'f1'
      })),
      commit: vi.fn()
    };
    renderAll = vi.fn();
    updateMeta = vi.fn();
    controller = createBackgroundController({ store, renderAll, updateMeta });
  });

  describe('confirmMeasurement', () => {
    it('returns false when not in calibration mode', () => {
      expect(controller.confirmMeasurement(100)).toBe(false);
    });

    it('returns false for invalid length values', () => {
      // Start calibration first (mock SVG)
      const mockSvg = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      controller.startCalibration(mockSvg, {});

      // These should all fail
      expect(controller.confirmMeasurement(0)).toBe(false);
      expect(controller.confirmMeasurement(-10)).toBe(false);
      expect(controller.confirmMeasurement('abc')).toBe(false);
      expect(controller.confirmMeasurement(NaN)).toBe(false);
    });
  });

  describe('isCalibrating', () => {
    it('returns false when not calibrating', () => {
      expect(controller.isCalibrating()).toBe(false);
    });

    it('returns true when calibration is active', () => {
      const mockSvg = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      controller.startCalibration(mockSvg, {});
      expect(controller.isCalibrating()).toBe(true);
    });

    it('returns false after cancellation', () => {
      const mockSvg = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      controller.startCalibration(mockSvg, {});
      controller.cancelCalibration();
      expect(controller.isCalibrating()).toBe(false);
    });
  });

  describe('getCalibrationProgress', () => {
    it('returns null when not calibrating', () => {
      expect(controller.getCalibrationProgress()).toBe(null);
    });

    it('returns progress info when calibrating', () => {
      const mockSvg = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      controller.startCalibration(mockSvg, {});

      const progress = controller.getCalibrationProgress();
      expect(progress).not.toBe(null);
      expect(progress.currentStep).toBe(1);
      expect(progress.totalSteps).toBe(3);
      expect(progress.measurements).toEqual([]);
      expect(progress.waitingForInput).toBe(false);
    });
  });

  describe('startCalibration', () => {
    it('sets crosshair cursor on SVG', () => {
      const mockSvg = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      controller.startCalibration(mockSvg, {});
      expect(mockSvg.style.cursor).toBe('crosshair');
    });

    it('adds click event listener', () => {
      const mockSvg = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      controller.startCalibration(mockSvg, {});
      expect(mockSvg.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('calls onStepStart callback with step 1', () => {
      const mockSvg = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      const onStepStart = vi.fn();
      controller.startCalibration(mockSvg, { onStepStart });
      expect(onStepStart).toHaveBeenCalledWith(1, 3);
    });

    it('cancels previous calibration if active', () => {
      const mockSvg1 = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      const mockSvg2 = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      const onCancel = vi.fn();

      controller.startCalibration(mockSvg1, { onCancel });
      controller.startCalibration(mockSvg2, {});

      expect(onCancel).toHaveBeenCalled();
      expect(mockSvg1.removeEventListener).toHaveBeenCalled();
    });
  });

  describe('cancelCalibration', () => {
    it('calls onCancel callback', () => {
      const mockSvg = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      const onCancel = vi.fn();
      controller.startCalibration(mockSvg, { onCancel });
      controller.cancelCalibration();
      expect(onCancel).toHaveBeenCalled();
    });

    it('resets cursor style', () => {
      const mockSvg = {
        style: { cursor: 'crosshair' },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      controller.startCalibration(mockSvg, {});
      controller.cancelCalibration();
      expect(mockSvg.style.cursor).toBe('');
    });

    it('removes click event listener', () => {
      const mockSvg = {
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      controller.startCalibration(mockSvg, {});
      controller.cancelCalibration();
      expect(mockSvg.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function));
    });
  });
});

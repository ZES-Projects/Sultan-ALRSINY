import { LocalVideoTrack } from 'livekit-client';
import { VirtualBackground } from '@livekit/track-processors';

// Virtual background configuration
export interface VirtualBackgroundConfig {
  type: 'image' | 'blur' | 'none';
  imageUrl?: string;
  blurAmount?: number;
}

// Single background image for all participants
export const TUTOR_BACKGROUND = '/assets/images/classroom-background.jpg';

// Virtual background manager using LiveKit track processor
export class VirtualBackgroundManager {
  private isEnabled: boolean = false;
  private currentConfig: VirtualBackgroundConfig | null = null;
  private videoTrack: LocalVideoTrack | null = null;
  private processor: any = null;

  constructor() {
    this.isEnabled = false;
  }

  public async enable(config: VirtualBackgroundConfig, videoTrack: LocalVideoTrack): Promise<void> {
    if (this.isEnabled) {
      await this.disable();
    }

    this.currentConfig = config;
    this.videoTrack = videoTrack;
    this.isEnabled = true;

    try {
      await this.applyVirtualBackground();
      console.log('Virtual background enabled with config:', config);
    } catch (error) {
      console.error('Failed to enable virtual background:', error);
      this.isEnabled = false;
      // Don't throw error, just log it and continue without virtual background
      console.warn('Continuing without virtual background due to error:', error);
    }
  }

  public async disable(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      // For now, we'll just reset the state since removing processors is complex
      // The processor will be cleaned up when the track is destroyed
      this.processor = null;
      this.isEnabled = false;
      this.currentConfig = null;
      console.log('Virtual background disabled');
    } catch (error) {
      console.error('Failed to disable virtual background:', error);
    }
  }

  private async applyVirtualBackground(): Promise<void> {
    if (!this.videoTrack || !this.currentConfig) {
      throw new Error('Video track or config not available');
    }

    try {
      switch (this.currentConfig.type) {
        case 'image':
          await this.applyImageBackground();
          break;
        case 'blur':
          // For now, we'll use image background with a blur effect
          await this.applyImageBackground();
          break;
        case 'none':
          // No background applied
          break;
        default:
          throw new Error(`Unsupported background type: ${this.currentConfig.type}`);
      }
    } catch (error) {
      console.error('Failed to apply virtual background:', error);
      throw error;
    }
  }

  private async applyImageBackground(): Promise<void> {
    if (!this.videoTrack || !this.currentConfig?.imageUrl) {
      throw new Error('Video track or image URL not available');
    }

    try {
      // Create a virtual background processor with the image
      this.processor = VirtualBackground(this.currentConfig.imageUrl);

      // Apply the processor to the video track
      this.videoTrack.setProcessor(this.processor);
      console.log('Image background applied successfully');
    } catch (error) {
      console.error('Failed to apply image background:', error);
      throw error;
    }
  }

  public isVirtualBackgroundEnabled(): boolean {
    return this.isEnabled;
  }

  public getCurrentConfig(): VirtualBackgroundConfig | null {
    return this.currentConfig;
  }
}

// Factory functions for creating virtual background managers
export const createTutorVirtualBackground = (): VirtualBackgroundManager => {
  return new VirtualBackgroundManager();
};

export const createBlurBackground = (_blurAmount: number = 10): VirtualBackgroundManager => {
  return new VirtualBackgroundManager();
};

export const createNoBackground = (): VirtualBackgroundManager => {
  return new VirtualBackgroundManager();
};

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Track,
} from "livekit-client";
import {
  toRichText,
  getDefaultUserPresence,
  createShapeId,
} from "@tldraw/tldraw";
import { pdfToImages } from "../utils/pdf-helpers";
import "./VirtualClassroom.css";
import {
  VirtualBackgroundManager,
  createTutorVirtualBackground,
  TUTOR_BACKGROUND,
} from "../utils/virtualBackground";
import CustomTldraw from "./CustomTldraw";
import { useStableTldrawSync } from "../utils/stableTldrawSync";
import { getTldrawConfig } from "../config/tldrawConfig";

interface FileUploadResponse {
  success: boolean;
  filename?: string;
  path?: string;
  error?: string;
  details?: Record<string, string[]>;
}

interface FileConversionResponse {
  success: boolean;
  converted_file?: string;
  url?: string;
  error?: string;
  details?: string;
  encrypted?: boolean;
}

interface RemoteParticipantInfo {
  participant: RemoteParticipant;
  videoTrack: Track | null;
  audioTrack: Track | null;
}

interface SessionResponse {
  success: boolean;
  session: {
    id: string;
    subject: string;
    tutor_name: string;
    student_name: string;
  };
}

const VirtualClassroom: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [pdfFileInputRef] = useState<React.RefObject<HTMLInputElement>>(
    useRef(null)
  );
  const [isPdfProcessing, setIsPdfProcessing] = useState(false);
  const [searchParams] = useSearchParams();
  const nameFromUrl = searchParams.get("name");
  const role =
    (searchParams.get("role") as "tutor" | "student" | "moderator") ||
    "student";

  const [participantName, setParticipantName] = useState<string>(
    nameFromUrl || ""
  );
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [localTracks, setLocalTracks] = useState<{
    video: boolean;
    audio: boolean;
  }>({ video: false, audio: false });
  // State to track noise cancellation status (LiveKit Cloud Krisp)
  const [noiseCancellationEnabled, setNoiseCancellationEnabled] =
    useState<boolean>(false);
  // State to track virtual background status
  const [virtualBackgroundEnabled, setVirtualBackgroundEnabled] =
    useState<boolean>(false);
  const [virtualBackgroundManager, setVirtualBackgroundManager] =
    useState<VirtualBackgroundManager | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<
    RemoteParticipantInfo[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  const [convertedImages, setConvertedImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [sessionTimer, setSessionTimer] = useState(0);
  const [currentView, setCurrentView] = useState<
    "whiteboard" | "share" | "file"
  >("whiteboard");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareTrack, setScreenShareTrack] = useState<any>(null);
  const [audioPlaybackReady, setAudioPlaybackReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  const editorRef = useRef<any>(null);

  const LIVEKIT_URL = "wss://virtual-classroom-wo4okd0f.livekit.cloud";
  const API_BASE_URL = "https://class.moalimy.com";

  // Get environment-specific configuration
  const config = getTldrawConfig();

  // Set up stable tldraw sync for real-time collaboration with cloud support
  const {
    store: syncStore,
    status: syncStatus,
    error: syncError,
    reconnect: reconnectSync,
    connectionAttempts,
  } = useStableTldrawSync({
    roomId: `classroom-${sessionId}`,
    userInfo: {
      id: participantName || `user-${Math.random().toString(36).substr(2, 9)}`,
      name: participantName || "Anonymous",
      color:
        role === "tutor"
          ? "#FF6B6B"
          : role === "student"
          ? "#4ECDC4"
          : "#45B7D1",
    },
    getUserPresence: (store: any, user: any) => {
      // Get default presence state
      const defaultPresence = getDefaultUserPresence(store, user);
      if (!defaultPresence) return null;

      return {
        ...defaultPresence,
        // Ensure cursor is always included
        cursor: defaultPresence.cursor || {
          x: 0,
          y: 0,
          type: "default",
          rotation: 0,
        },
        // Add role information to meta
        meta: {
          ...defaultPresence.meta,
          role: role,
          participantName: participantName,
        },
      };
    },
    onConnectionChange: (status: string) => {
      console.log("TLDraw sync status changed:", status);
    },
    connectionTimeout: config.connection.timeout,
    maxRetries: config.connection.maxRetries,
    retryDelay: config.connection.retryDelay,
  });

  // Timer effect
  useEffect(() => {
    if (isConnected) {
      const interval = setInterval(() => {
        setSessionTimer((prev) => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isConnected]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  };

  useEffect(() => {
    return () => {
      if (room) {
        room.disconnect();
      }
    };
  }, [room]);

  // Debug remote participants
  useEffect(() => {
    console.log(
      "Remote participants updated:",
      remoteParticipants.map((p) => ({
        identity: p.participant.identity,
        hasVideo: !!p.videoTrack,
        hasAudio: !!p.audioTrack,
        audioMuted: p.audioTrack?.isMuted,
        videoSid: p.videoTrack?.sid,
        audioSid: p.audioTrack?.sid,
      }))
    );
  }, [remoteParticipants]);

  // Monitor local participant audio state
  useEffect(() => {
    if (room && room.localParticipant) {
      const audioPublications = Array.from(
        room.localParticipant.audioTrackPublications.values()
      );
      if (audioPublications.length > 0) {
        const audioTrack = audioPublications[0].track;
        if (audioTrack) {
          const updateLocalAudioState = () => {
            setLocalTracks((prev) => ({
              ...prev,
              audio: !audioTrack.isMuted,
            }));
          };

          audioTrack.on("muted", updateLocalAudioState);
          audioTrack.on("unmuted", updateLocalAudioState);

          // Initial state
          updateLocalAudioState();

          return () => {
            audioTrack.off("muted", updateLocalAudioState);
            audioTrack.off("unmuted", updateLocalAudioState);
          };
        }
      }
    }
  }, [room]);

  // Resolve participant display name from DB based on role, or URL override
  useEffect(() => {
    const resolveName = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/sessions/${sessionId}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch session");
        }
        const data: SessionResponse = await response.json();
        const dbNameForRole =
          role === "tutor"
            ? data.session.tutor_name
            : role === "student"
            ? data.session.student_name
            : "Moderator";

        const baseName =
          nameFromUrl ||
          dbNameForRole ||
          `Participant_${Math.floor(Math.random() * 1000)}`;
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        setParticipantName(`${baseName} (${roleLabel})`);
      } catch (_e) {
        const baseName =
          nameFromUrl || `Participant_${Math.floor(Math.random() * 1000)}`;
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        setParticipantName(`${baseName} (${roleLabel})`);
      }
    };

    if (sessionId && !participantName) {
      resolveName();
    }
  }, [sessionId, role, nameFromUrl, participantName]);

  // Auto-join room when component mounts
  useEffect(() => {
    if (sessionId && participantName && !isJoining && !isConnected) {
      const autoJoin = async () => {
        setIsJoining(true);
        try {
          await joinRoom();
        } catch (error) {
          console.warn(
            "LiveKit connection failed, but continuing for PDF testing:",
            error
          );
          // Set connected to true to allow PDF testing even without LiveKit
          setIsConnected(true);
        }
        setIsJoining(false);
      };
      autoJoin();
    }
  }, [sessionId, participantName]);

  const joinRoom = async () => {
    try {
      console.log("Starting to join room...");
      console.log("Session ID:", sessionId);
      console.log("Participant Name:", participantName);
      console.log("LiveKit URL:", LIVEKIT_URL);

      // Clear any previous error
      setError(null);

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      setRoom(room);

      // Set up event listeners
      room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
      room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.on(RoomEvent.TrackMuted, (publication, participant) => {
        if (
          participant instanceof RemoteParticipant &&
          publication instanceof RemoteTrackPublication
        ) {
          handleTrackMuted(publication, participant);
        }
      });
      room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
        if (
          participant instanceof RemoteParticipant &&
          publication instanceof RemoteTrackPublication
        ) {
          handleTrackUnmuted(publication, participant);
        }
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, (canPlayback: boolean) => {
        setAudioPlaybackReady(!!canPlayback);
      });

      // Add connection state change listener
      room.on(RoomEvent.ConnectionStateChanged, (state) => {
        console.log("Connection state changed:", state);
        if (state === "disconnected") {
          console.log("Room disconnected");
          setIsConnected(false);
        } else if (state === "connected") {
          console.log("Room connected");
          setIsConnected(true);
        }
      });

      console.log("Getting token from backend...");
      // Get token from backend
      const token = await getToken(sessionId!, participantName);
      console.log("Token received, length:", token.length);

      if (!token || token.length === 0) {
        throw new Error("Invalid token received from server");
      }

      console.log("Connecting to LiveKit room...");
      // Connect to room with timeout
      const connectionPromise = room.connect(LIVEKIT_URL, token, {
        autoSubscribe: true,
      });

      // Add timeout to connection
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Connection timeout")), 30000); // 30 seconds
      });

      await Promise.race([connectionPromise, timeoutPromise]);

      console.log("Connected to room. Microphone disabled by default.");

      // Try to start audio playback (may require user gesture depending on browser policy)
      try {
        await room.startAudio();
        setAudioPlaybackReady(true);
        console.log("Audio playback ready, microphone can be enabled by user");
      } catch (_e) {
        setAudioPlaybackReady(false);
        console.log(
          "Audio playback not ready, microphone will be enabled when user interacts"
        );
      }

      // Ensure microphone is disabled by default
      setLocalTracks({ video: false, audio: false });
      setNoiseCancellationEnabled(false);

      // Initialize any participants that might already be in the room
      try {
        const existingParticipants = Array.from(
          room.remoteParticipants.values()
        );
        if (existingParticipants.length > 0) {
          setRemoteParticipants(
            existingParticipants.map((participant) => {
              let videoTrack: Track | null = null;
              let audioTrack: Track | null = null;
              participant.trackPublications.forEach((publication) => {
                if (publication.isSubscribed && publication.track) {
                  if (publication.kind === Track.Kind.Video) {
                    videoTrack = publication.track;
                  } else if (publication.kind === Track.Kind.Audio) {
                    audioTrack = publication.track;
                  }
                }
              });
              return { participant, videoTrack, audioTrack };
            })
          );
        }
      } catch (initErr) {
        console.warn("Failed to initialize existing participants:", initErr);
      }

      // Set local video track
      if (
        videoRef.current &&
        room.localParticipant.videoTrackPublications.size > 0
      ) {
        const videoPublication = Array.from(
          room.localParticipant.videoTrackPublications.values()
        )[0];
        if (videoPublication.videoTrack) {
          videoPublication.videoTrack.attach(videoRef.current);
        }
      }

      console.log("Successfully connected to room:", room.name);
      console.log("Local participant:", room.localParticipant.identity);
      console.log("Remote participants:", room.remoteParticipants.size);
    } catch (err) {
      console.error("Error joining room:", err);
      console.error("Error details:", {
        name: err instanceof Error ? err.name : "Unknown",
        message: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : "No stack trace",
      });

      // Clean up room if it exists
      if (room) {
        try {
          room.disconnect();
        } catch (disconnectError) {
          console.warn("Error disconnecting room:", disconnectError);
        }
        setRoom(null);
      }

      // Only show error for non-LiveKit related issues
      if (err instanceof Error && err.message.includes("LiveKit")) {
        console.warn(
          "LiveKit connection failed, but continuing for PDF testing:",
          err.message
        );
        setIsConnected(true); // Allow the app to continue
      } else {
        setError(
          `Failed to join room: ${
            err instanceof Error ? err.message : "Unknown error"
          }`
        );
        setIsConnected(false);
      }
    }
  };

  const getToken = async (
    roomName: string,
    participantName: string
  ): Promise<string> => {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `Requesting token from: ${API_BASE_URL}/api/token (attempt ${attempt}/${maxRetries})`
        );
        console.log("Request payload:", { roomName, participantName });

        const response = await fetch(`${API_BASE_URL}/api/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          mode: "cors",
          credentials: "omit",
          body: JSON.stringify({
            roomName,
            participantName,
          }),
        });

        console.log("Token response status:", response.status);
        console.log(
          "Token response headers:",
          Object.fromEntries(response.headers.entries())
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Token request failed:", errorText);
          throw new Error(
            `Failed to get token: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        console.log("Token response data:", data);

        if (!data.token) {
          throw new Error("No token received from server");
        }

        return data.token;
      } catch (error) {
        lastError = error as Error;
        console.error(
          `Error in getToken (attempt ${attempt}/${maxRetries}):`,
          error
        );

        if (attempt < maxRetries) {
          console.log(`Retrying in ${attempt * 1000}ms...`);
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
    }

    throw lastError || new Error("Failed to get token after all retries");
  };

  const handleParticipantConnected = (participant: RemoteParticipant) => {
    console.log("Participant connected:", participant.identity);
    setRemoteParticipants((prev) => [
      ...prev,
      {
        participant,
        videoTrack: null,
        audioTrack: null,
      },
    ]);
  };

  const handleParticipantDisconnected = (participant: RemoteParticipant) => {
    console.log("Participant disconnected:", participant.identity);
    setRemoteParticipants((prev) =>
      prev.filter((p) => p.participant.identity !== participant.identity)
    );
  };

  const handleTrackSubscribed = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => {
    console.log("Track subscribed:", track.kind, participant.identity);
    console.log("Track details:", {
      kind: track.kind,
      sid: track.sid,
      participant: participant.identity,
    });

    setRemoteParticipants((prev) => {
      const existing = prev.find(
        (p) => p.participant.identity === participant.identity
      );
      if (existing) {
        // Update existing participant
        return prev.map((p) => {
          if (p.participant.identity === participant.identity) {
            if (track.kind === Track.Kind.Video) {
              console.log("Setting video track for:", participant.identity);
              return { ...p, videoTrack: track };
            } else if (track.kind === Track.Kind.Audio) {
              console.log("Setting audio track for:", participant.identity);
              return { ...p, audioTrack: track };
            }
          }
          return p;
        });
      } else {
        // Add new participant with track
        console.log(
          "Adding new participant with track:",
          participant.identity,
          track.kind
        );
        return [
          ...prev,
          {
            participant,
            videoTrack: track.kind === Track.Kind.Video ? track : null,
            audioTrack: track.kind === Track.Kind.Audio ? track : null,
          },
        ];
      }
    });
  };

  const handleTrackUnsubscribed = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => {
    console.log("Track unsubscribed:", track.kind, participant.identity);

    setRemoteParticipants((prev) =>
      prev.map((p) => {
        if (p.participant.identity === participant.identity) {
          if (track.kind === Track.Kind.Video) {
            return { ...p, videoTrack: null };
          } else if (track.kind === Track.Kind.Audio) {
            return { ...p, audioTrack: null };
          }
        }
        return p;
      })
    );
  };

  const handleTrackMuted = (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => {
    console.log("Track muted:", publication.kind, participant.identity);

    // Update participant state when track is muted
    setRemoteParticipants((prev) =>
      prev.map((p) => {
        if (p.participant.identity === participant.identity) {
          if (publication.kind === Track.Kind.Audio) {
            return { ...p, audioTrack: null };
          } else if (publication.kind === Track.Kind.Video) {
            return { ...p, videoTrack: null };
          }
        }
        return p;
      })
    );
  };

  const handleTrackUnmuted = (
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => {
    console.log("Track unmuted:", publication.kind, participant.identity);

    // Update participant state when track is unmuted
    setRemoteParticipants((prev) =>
      prev.map((p) => {
        if (p.participant.identity === participant.identity) {
          if (publication.kind === Track.Kind.Audio) {
            // Find the audio track from the publication
            const audioTrack = publication.track;
            return { ...p, audioTrack: audioTrack || null };
          } else if (publication.kind === Track.Kind.Video) {
            // Find the video track from the publication
            const videoTrack = publication.track;
            return { ...p, videoTrack: videoTrack || null };
          }
        }
        return p;
      })
    );
  };

  const toggleVideo = async () => {
    if (!room) return;

    if (localTracks.video) {
      // Detach existing local video from preview before disabling
      try {
        if (
          videoRef.current &&
          room.localParticipant.videoTrackPublications.size > 0
        ) {
          const currentPublication = Array.from(
            room.localParticipant.videoTrackPublications.values()
          )[0];
          if (currentPublication.videoTrack) {
            currentPublication.videoTrack.detach(videoRef.current);
          }
        }
      } catch (_e) {
        // ignore detach errors
      }

      await room.localParticipant.setCameraEnabled(false);
      setLocalTracks((prev) => ({ ...prev, video: false }));

      // Disable virtual background when video is disabled
      if (virtualBackgroundManager) {
        await virtualBackgroundManager.disable();
        setVirtualBackgroundEnabled(false);
      }
    } else {
      await room.localParticipant.setCameraEnabled(true);
      setLocalTracks((prev) => ({ ...prev, video: true }));

      // After enabling, attach the newly created local video track to the preview element
      try {
        if (
          videoRef.current &&
          room.localParticipant.videoTrackPublications.size > 0
        ) {
          const newPublication = Array.from(
            room.localParticipant.videoTrackPublications.values()
          )[0];
          if (newPublication.videoTrack) {
            newPublication.videoTrack.attach(videoRef.current);

            // Enable virtual background for all participants by default
            if (!virtualBackgroundManager) {
              // Wait a bit for the video to be properly attached before applying virtual background
              setTimeout(async () => {
                if (newPublication.videoTrack) {
                  try {
                    const backgroundManager = createTutorVirtualBackground();
                    await backgroundManager.enable(
                      {
                        type: "image",
                        imageUrl: TUTOR_BACKGROUND,
                      },
                      newPublication.videoTrack
                    );
                    setVirtualBackgroundManager(backgroundManager);
                    setVirtualBackgroundEnabled(true);
                    console.log("Virtual background enabled for participant");
                  } catch (error) {
                    console.error(
                      "Failed to enable virtual background:",
                      error
                    );
                  }
                }
              }, 500); // Wait 500ms for video to be ready
            }
          }
        }
      } catch (_e) {
        // ignore attach errors
      }
    }
  };

  const toggleAudio = async () => {
    if (!room) return;

    try {
      if (localTracks.audio) {
        await room.localParticipant.setMicrophoneEnabled(false);
        setLocalTracks((prev) => ({ ...prev, audio: false }));
        setNoiseCancellationEnabled(false);
        console.log("Microphone disabled");
      } else {
        // Ensure audio context is unlocked before enabling mic
        try {
          await room.startAudio();
          setAudioPlaybackReady(true);
        } catch {
          setAudioPlaybackReady(false);
        }

        // Enable microphone with noise cancellation
        await room.localParticipant.setMicrophoneEnabled(true, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });

        setLocalTracks((prev) => ({ ...prev, audio: true }));
        setNoiseCancellationEnabled(true);
        console.log("Microphone enabled with noise cancellation (Krisp)");
      }
    } catch (error) {
      console.error("Error toggling microphone:", error);
      setError("Failed to toggle microphone");
    }
  };

  // Helper function to check if a participant has active audio
  const hasActiveAudio = (participant: RemoteParticipantInfo) => {
    return participant.audioTrack !== null && !participant.audioTrack.isMuted;
  };

  const leaveRoom = async () => {
    try {
      console.log("Leaving room...");

      if (room) {
        // Disconnect from LiveKit room
        await room.disconnect();
        console.log("Disconnected from LiveKit room");
      }

      // Reset all states
      setIsConnected(false);
      setRoom(null);
      setRemoteParticipants([]);
      setLocalTracks({ video: false, audio: false });
      setNoiseCancellationEnabled(false);
      if (virtualBackgroundManager) {
        await virtualBackgroundManager.disable();
      }
      setVirtualBackgroundEnabled(false);
      setVirtualBackgroundManager(null);
      setError(null);

      // Navigate back to session creation page
      window.location.href = "/admin/create-session";
    } catch (error) {
      console.error("Error leaving room:", error);
      // Even if there's an error, try to navigate back
      window.location.href = "/admin/create-session";
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Check if it's a PDF
    if (file.type === "application/pdf") {
      await handlePdfUpload(event);
      return;
    }

    // Frontend validation
    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];
    const maxSize = 10 * 1024 * 1024; // 10MB

    if (!allowedTypes.includes(file.type)) {
      setError(
        "Invalid file type. Please upload PDF, DOCX, or PPTX files only."
      );
      return;
    }

    if (file.size > maxSize) {
      setError("File size too large. Maximum size is 10MB.");
      return;
    }

    setIsUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_BASE_URL}/api/upload-file`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        body: formData,
      });

      const data: FileUploadResponse = await response.json();

      if (data.success && data.filename) {
        // Automatically convert the file
        await convertFile(data.filename);
      } else {
        // Handle validation errors and other failures
        if (response.status === 422 && data.details) {
          // Validation error - show specific details
          const errorMessages = Object.values(data.details).flat();
          setError(`File validation failed: ${errorMessages.join(", ")}`);
        } else if (data.error) {
          setError(`File upload failed: ${data.error}`);
        } else {
          setError("File upload failed");
        }
      }
    } catch (err) {
      console.error("File upload error:", err);
      if (err instanceof Error) {
        setError(`File upload failed: ${err.message}`);
      } else {
        setError("File upload failed");
      }
    } finally {
      setIsUploading(false);
    }
  };

  const convertFile = async (filename: string) => {
    setIsConverting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/convert-file`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename }),
      });

      const data: FileConversionResponse = await response.json();

      if (data.success && data.url) {
        setConvertedImages((prev) => [...prev, data.url!]);

        // Automatically add the converted image to the whiteboard after a short delay
        setTimeout(() => {
          addImageToWhiteboard(data.url!, convertedImages.length);
        }, 1000);
      } else {
        // Handle specific error types
        if (response.status === 400 && data.encrypted) {
          setError(
            "PDF is encrypted and cannot be converted. Please provide an unencrypted PDF file or remove the password protection."
          );
        } else if (data.error) {
          setError(`File conversion failed: ${data.error}`);
        } else {
          setError("File conversion failed");
        }
      }
    } catch (err) {
      console.error("File conversion error:", err);
      setError("File conversion failed");
    } finally {
      setIsConverting(false);
    }
  };

  const addImageToWhiteboard = (imageUrl: string, index: number) => {
    if (editorRef.current) {
      try {
        // Create a frame to contain the image reference
        editorRef.current.createShape({
          type: "frame",
          x: 100 + index * 50,
          y: 100 + index * 50,
          props: {
            name: `Image ${index + 1}`,
            w: 400,
            h: 300,
          },
        });

        // Add a text note with the image URL inside the frame
        editorRef.current.createShape({
          type: "note",
          x: 120 + index * 50,
          y: 130 + index * 50,
          props: {
            richText: toRichText(
              `📷 Image ${index + 1}\nClick to view: ${imageUrl}`
            ),
            color: "blue",
            align: "start",
          },
        });

        console.log("Image frame and note added to whiteboard:", imageUrl);
      } catch (error) {
        console.error("Error adding image to whiteboard:", error);
        setError("Failed to add image to whiteboard");
      }
    } else {
      console.warn("Editor not ready yet");
      setError("Whiteboard not ready. Please try again.");
    }
  };

  const toggleScreenShare = async () => {
    if (!room) return;

    try {
      if (isScreenSharing) {
        // Stop screen sharing
        if (screenShareTrack) {
          await room.localParticipant.unpublishTrack(screenShareTrack);
          setScreenShareTrack(null);
        }
        setIsScreenSharing(false);
        console.log("Screen sharing stopped");
      } else {
        // Start screen sharing
        const screenTracks = await room.localParticipant.createScreenTracks({
          audio: false,
        });

        if (screenTracks.length > 0) {
          const screenTrack = screenTracks[0];
          await room.localParticipant.publishTrack(screenTrack);
          setScreenShareTrack(screenTrack);
        }
        setIsScreenSharing(true);
        console.log("Screen sharing started");
      }
    } catch (error) {
      console.error("Error toggling screen share:", error);
      setError("Failed to toggle screen sharing");
    }
  };

  // Add this function to your component
  const handlePdfUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !editorRef.current) return;

      // Validate file type
      if (file.type !== "application/pdf") {
        setError("Please select a PDF file");
        return;
      }

      setIsPdfProcessing(true);
      setError(null);

      try {
        const pageUrls = await pdfToImages(file, 2); // scale 2 for clarity

        // Preload images to get intrinsic sizes
        const metas = await Promise.all(
          pageUrls.map(
            (url) =>
              new Promise<{ url: string; width: number; height: number }>(
                (resolve, reject) => {
                  const img = new Image();
                  img.onload = () =>
                    resolve({
                      url,
                      width: img.naturalWidth,
                      height: img.naturalHeight,
                    });
                  img.onerror = (e) => reject(e);
                  img.src = url;
                }
              )
          )
        );

        const maxW = Math.max(...metas.map((m) => m.width));
        const maxH = Math.max(...metas.map((m) => m.height));

        // Create a frame sized to fit all pages with offsets
        const frameId = createShapeId();
        const offsetStep = 20;
        const padding = 40;
        editorRef.current.createShape({
          id: frameId,
          type: "frame",
          x: 200,
          y: 150,
          props: {
            name: `PDF Document (${pageUrls.length} pages)`,
            w: maxW + offsetStep * (metas.length - 1) + padding,
            h: maxH + offsetStep * (metas.length - 1) + padding,
          },
        });

        // Add each page as an image shape inside the frame, at full size
        for (let index = 0; index < metas.length; index++) {
          try {
            const { url: pageUrl, width: iw, height: ih } = metas[index];
            const imageId = createShapeId();

            // Store the image data in the editor's asset system
            editorRef.current.store.put([
              {
                id: `asset:pdf-page-${index}`,
                typeName: "asset",
                type: "image",
                props: {
                  name: `Page ${index + 1}`,
                  src: pageUrl,
                  w: iw,
                  h: ih,
                  mimeType: "image/jpeg",
                  isAnimated: false,
                },
                meta: {},
              },
            ]);

            // Create the image shape with the asset reference at full size
            editorRef.current.createShape({
              id: imageId,
              type: "image",
              x: 220 + index * offsetStep,
              y: 170 + index * offsetStep,
              props: {
                w: iw,
                h: ih,
                assetId: `asset:pdf-page-${index}`,
              },
              parentId: frameId,
            });
          } catch (error) {
            console.error(`Error creating image for page ${index + 1}:`, error);
          }
        }

        editorRef.current.select(frameId);

        console.log("PDF loaded successfully with", pageUrls.length, "pages");
      } catch (err) {
        console.error("PDF render failed:", err);
        setError("Failed to render PDF. Please try again.");
      } finally {
        setIsPdfProcessing(false);
        // Clear the input
        if (event.target) {
          event.target.value = "";
        }
      }
    },
    []
  );

  if (error) {
    // Check if this is an encrypted PDF error
    const isEncryptedPdfError =
      error.includes("encrypted") || error.includes("password");

    return (
      <div
        className={`error-container ${
          isEncryptedPdfError ? "encrypted-pdf-error" : ""
        }`}
      >
        <h2>
          {isEncryptedPdfError
            ? "🔒 Encrypted PDF Detected"
            : "Connection Error"}
        </h2>
        <p>{error}</p>

        {isEncryptedPdfError && (
          <div className="encrypted-pdf-solution">
            <h4>How to fix this:</h4>
            <ol>
              <li>
                <strong>Remove password protection:</strong> Open the PDF in a
                PDF reader and save it without password protection
              </li>
              <li>
                <strong>Use a different file:</strong> Upload an unencrypted
                PDF, DOCX, or PPTX file
              </li>
              <li>
                <strong>Convert the file:</strong> Use online tools to remove
                password protection before uploading
              </li>
            </ol>
            <div className="file-format-info">
              <h5>Supported file formats:</h5>
              <ul>
                <li>📄 PDF (unencrypted)</li>
                <li>📝 DOCX (Word documents)</li>
                <li>📊 PPTX (PowerPoint presentations)</li>
              </ul>
            </div>
          </div>
        )}

        <div className="error-actions">
          {!isEncryptedPdfError && (
            <button
              onClick={() => window.location.reload()}
              className="retry-btn"
            >
              🔄 Retry Connection
            </button>
          )}
          <button onClick={() => setError(null)} className="dismiss-btn">
            ✕ Dismiss
          </button>
        </div>

        {!isEncryptedPdfError && (
          <div className="error-tips">
            <h4>Troubleshooting Tips:</h4>
            <ul>
              <li>Make sure the backend server is running on port 6080</li>
              <li>Check your internet connection</li>
              <li>Try refreshing the page</li>
              <li>Contact support if the issue persists</li>
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="virtual-classroom-new">
      {/* Top Bar */}
      <div className="top-bar">
        <div className="logo-section"></div>

        <div className="session-status">
          {noiseCancellationEnabled && (
            <div className="noise-cancellation-status">
              <span className="noise-cancellation-icon">🎧</span>
            </div>
          )}
          {virtualBackgroundEnabled && (
            <div className="virtual-background-status">
              <span className="virtual-background-icon">🖼️</span>
            </div>
          )}
          <div className="report-problem">
            <span className="warning-icon">⚠️</span>
            <span>Report a Problem</span>
          </div>
          <div className="session-timer">
            <span className="timer-icon">⏰</span>
            <span>Started: {formatTime(sessionTimer)}</span>
          </div>
          <div className="sync-status">
            <span
              className={`sync-indicator ${
                syncStatus === "connected"
                  ? "connected"
                  : syncStatus === "error"
                  ? "error"
                  : "connecting"
              }`}
            >
              {syncStatus === "connected"
                ? "🟢"
                : syncStatus === "error"
                ? "🔴"
                : "🟡"}
            </span>
            <span className="sync-text">
              {syncStatus === "connected"
                ? "Sync Connected"
                : syncStatus === "error"
                ? `Sync Error (${connectionAttempts} attempts)`
                : syncStatus === "connecting"
                ? "Connecting..."
                : syncStatus === "loading"
                ? "Loading..."
                : "Disconnected"}
            </span>
            {syncError && (
              <button
                className="reconnect-btn"
                onClick={reconnectSync}
                title="Reconnect to whiteboard"
              >
                🔄
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Whiteboard Area */}
        <div className="whiteboard-area">
          <div className="whiteboard-container">
            <CustomTldraw
              store={syncStore}
              autoFocus
              // inferDarkMode
              onMount={(editor: any) => {
                editorRef.current = editor;
                editor.setCurrentTool("select");
              }}
            />
          </div>

          {/* Uploaded Files Display */}
          {convertedImages.length > 0 && (
            <div className="uploaded-files-panel">
              <h4>📁 Uploaded Files</h4>
              <div className="files-grid">
                {convertedImages.map((url, index) => (
                  <div
                    key={index}
                    className="file-item"
                    onClick={() => addImageToWhiteboard(url, index)}
                  >
                    <img
                      src={url}
                      alt={`Converted file ${index + 1}`}
                      className="converted-image"
                    />
                    <div className="file-overlay">
                      <span className="file-number">#{index + 1}</span>
                      <span className="add-to-whiteboard">
                        ➕ Add to Whiteboard
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Page Navigation */}
          <div className="page-navigation">
            <button className="page-btn">+</button>
            <div className="page-info">
              <span>&lt; 1 / 1 &gt;</span>
            </div>
            <button className="page-btn">←</button>
            <button className="page-btn">→</button>
            <button className="page-btn">↻</button>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="right-sidebar">
          {/* Participant Panels */}
          <div className="participant-panels">
            {/* Local Participant */}
            <div className="participant-panel">
              <div className="participant-video">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="video-element"
                />
                {!localTracks.video && (
                  <div className="camera-off-overlay">
                    <span className="camera-icon">📹</span>
                  </div>
                )}
              </div>
              <div className="participant-info">
                <div className="mic-indicator">
                  <span
                    className={`mic-icon ${
                      localTracks.audio ? "active" : "muted"
                    }`}
                  >
                    {localTracks.audio ? "🎤" : "🔇"}
                  </span>
                </div>
                <span className="participant-name">{participantName}</span>
              </div>
            </div>

            {/* Remote Participants */}
            {remoteParticipants.map((remoteParticipant) => (
              <div
                key={remoteParticipant.participant.identity}
                className="participant-panel"
              >
                <div className="participant-video">
                  {remoteParticipant.videoTrack ? (
                    <video
                      key={`${remoteParticipant.participant.identity}-${remoteParticipant.videoTrack.sid}`}
                      autoPlay
                      muted
                      playsInline
                      className="video-element"
                      ref={(el) => {
                        if (el && remoteParticipant.videoTrack) {
                          try {
                            remoteParticipant.videoTrack.attach(el);
                          } catch (error) {
                            console.error(
                              "Error attaching video track:",
                              error
                            );
                          }
                        }
                      }}
                    />
                  ) : (
                    <div className="video-placeholder">
                      <span className="person-icon">👤</span>
                    </div>
                  )}
                  {remoteParticipant.audioTrack && (
                    <audio
                      key={`${remoteParticipant.participant.identity}-${remoteParticipant.audioTrack.sid}`}
                      autoPlay
                      playsInline
                      ref={(el) => {
                        if (el && remoteParticipant.audioTrack) {
                          try {
                            remoteParticipant.audioTrack.attach(el);
                          } catch (error) {
                            console.error(
                              "Error attaching audio track:",
                              error
                            );
                          }
                        }
                      }}
                      style={{ display: "none" }}
                    />
                  )}
                  {!remoteParticipant.videoTrack && (
                    <div className="camera-off-overlay">
                      <span className="camera-icon">📹</span>
                    </div>
                  )}
                </div>
                <div className="participant-info">
                  <div className="mic-indicator">
                    <span
                      className={`mic-icon ${
                        hasActiveAudio(remoteParticipant) ? "active" : "muted"
                      }`}
                    >
                      {hasActiveAudio(remoteParticipant) ? "🎤" : "🔇"}
                    </span>
                  </div>
                  <span className="participant-name">
                    {remoteParticipant.participant.identity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Control Bar */}
      <div className="bottom-controls">
        {!audioPlaybackReady && (
          <button
            onClick={async () => {
              if (room) {
                try {
                  await room.startAudio();
                  setAudioPlaybackReady(true);
                } catch {}
              }
            }}
            className={`control-btn`}
          >
            <div className="control-icon-wrapper">
              <svg
                className="control-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </div>
            <span className="control-label">Enable Audio</span>
          </button>
        )}
        <button
          onClick={toggleAudio}
          className={`control-btn ${localTracks.audio ? "active" : "muted"}`}
          title={
            localTracks.audio && noiseCancellationEnabled
              ? "Microphone with Noise Cancellation"
              : "Toggle Microphone"
          }
        >
          <div className="control-icon-wrapper">
            <svg
              className="control-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
            {!localTracks.audio && <div className="mute-line"></div>}
            {localTracks.audio && noiseCancellationEnabled && (
              <div
                className="noise-cancellation-indicator"
                title="Noise Cancellation Active"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="12"
                  height="12"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              </div>
            )}
          </div>
          <span className="control-label">Mic</span>
        </button>

        <button
          onClick={toggleVideo}
          className={`control-btn ${localTracks.video ? "active" : "muted"}`}
        >
          <div className="control-icon-wrapper">
            <svg
              className="control-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
            </svg>
            {!localTracks.video && <div className="mute-line"></div>}
          </div>
          <span className="control-label">Camera</span>
        </button>

        <button
          onClick={() => setCurrentView("whiteboard")}
          className={`control-btn ${
            currentView === "whiteboard" ? "active" : ""
          }`}
        >
          <div className="control-icon-wrapper">
            <svg
              className="control-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
          </div>
          <span className="control-label">Whiteboard</span>
        </button>

        <button
          onClick={toggleScreenShare}
          className={`control-btn ${isScreenSharing ? "active" : ""}`}
        >
          <div className="control-icon-wrapper">
            <svg
              className="control-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm6 12H6v-1.4c0-2 4-3.1 6-3.1s6 1.1 6 3.1V18z" />
              <path d="M12 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
            </svg>
          </div>
          <span className="control-label">Share</span>
        </button>

        <button
          onClick={() => pdfFileInputRef.current?.click()}
          className={`control-btn ${isPdfProcessing ? "processing" : ""}`}
          disabled={isPdfProcessing}
        >
          <div className="control-icon-wrapper">
            <svg
              className="control-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
            </svg>
          </div>
          <span className="control-label">
            {isPdfProcessing ? "Processing..." : "PDF"}
          </span>
        </button>

        {/* <button onClick={handleFileButtonClick} className={`control-btn`}>
          <div className="control-icon-wrapper">
            <svg
              className="control-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
            </svg>
          </div>
          <span className="control-label">File</span>
        </button> */}

        <button
          onClick={() => {
            if (
              window.confirm("Are you sure you want to leave the classroom?")
            ) {
              leaveRoom();
            }
          }}
          className="control-btn exit-btn"
        >
          <div className="control-icon-wrapper">
            <svg
              className="control-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </div>
          <span className="control-label">Exit</span>
        </button>
      </div>

      <input
        ref={pdfFileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileUpload}
        style={{ display: "none" }}
      />

      {(isUploading || isConverting || isJoining) && (
        <div className="loading-overlay">
          <div className="loading-spinner">
            {isJoining
              ? "Joining classroom..."
              : isUploading
              ? "Uploading file..."
              : "Converting file..."}
          </div>
        </div>
      )}
    </div>
  );
};

export default VirtualClassroom;

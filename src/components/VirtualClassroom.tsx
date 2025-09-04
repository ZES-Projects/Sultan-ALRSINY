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
  createTLStore,
  Editor,
  TLParentId,
  TLShapeId,
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
import { PDFDocument } from "pdf-lib";

// ---------- Helpers ----------
const createAssetId = (id: string) => `asset:${id}`;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function pagePointToViewport(editor: Editor, x: number, y: number) {
  const anyEditor = editor as any;
  if (typeof anyEditor.pageToViewport === "function") {
    return anyEditor.pageToViewport({ x, y });
  }
  if (typeof anyEditor.pageToScreen === "function") {
    return anyEditor.pageToScreen({ x, y });
  }
  return { x, y };
}

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
  const [noiseCancellationEnabled, setNoiseCancellationEnabled] =
    useState<boolean>(false);
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
  const [pageGroups, setPageGroups] = useState<
    { id: TLShapeId; y: number; w: number; h: number; url: string }[]
  >([]);
  const [session, setSession] = useState<{
    id: string;
    subject: string;
    tutor_name: string;
    student_name: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties | null>(
    null
  );
  const [toolbarStyle, setToolbarStyle] = useState<React.CSSProperties | null>(
    null
  );
  const [viewerSize, setViewerSize] = useState<{ w: number; h: number } | null>(
    null
  );
  const [contentHeight, setContentHeight] = useState<number>(0);
  const [scroll, setScroll] = useState<number>(0);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const prevSizeRef = useRef<{ w: number; h: number } | null>(null);
  const frameIdRef = useRef<TLShapeId | null>(null);
  const contentGroupIdRef = useRef<TLShapeId | null>(null);

  const LIVEKIT_URL = "wss://virtual-classroom-wo4okd0f.livekit.cloud";
  const API_BASE_URL = "https://class.moalimy.com";

  const config = getTldrawConfig();

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
      const defaultPresence = getDefaultUserPresence(store, user);
      if (!defaultPresence) return null;

      return {
        ...defaultPresence,
        cursor: defaultPresence.cursor || {
          x: 0,
          y: 0,
          type: "default",
          rotation: 0,
        },
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

          updateLocalAudioState();

          return () => {
            audioTrack.off("muted", updateLocalAudioState);
            audioTrack.off("unmuted", updateLocalAudioState);
          };
        }
      }
    }
  }, [room]);

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
        setSession(data.session);
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

      setError(null);

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      setRoom(room);

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
      const token = await getToken(sessionId!, participantName);
      console.log("Token received, length:", token.length);

      if (!token || token.length === 0) {
        throw new Error("Invalid token received from server");
      }

      console.log("Connecting to LiveKit room...");
      const connectionPromise = room.connect(LIVEKIT_URL, token, {
        autoSubscribe: true,
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Connection timeout")), 30000);
      });

      await Promise.race([connectionPromise, timeoutPromise]);

      console.log("Connected to room. Microphone disabled by default.");

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

      setLocalTracks({ video: false, audio: false });
      setNoiseCancellationEnabled(false);

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

      if (room) {
        try {
          room.disconnect();
        } catch (disconnectError) {
          console.warn("Error disconnecting room:", disconnectError);
        }
        setRoom(null);
      }

      if (err instanceof Error && err.message.includes("LiveKit")) {
        console.warn(
          "LiveKit connection failed, but continuing for PDF testing:",
          err.message
        );
        setIsConnected(true);
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

    setRemoteParticipants((prev) =>
      prev.map((p) => {
        if (p.participant.identity === participant.identity) {
          if (publication.kind === Track.Kind.Audio) {
            const audioTrack = publication.track;
            return { ...p, audioTrack: audioTrack || null };
          } else if (publication.kind === Track.Kind.Video) {
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
      } catch (_e) {}

      await room.localParticipant.setCameraEnabled(false);
      setLocalTracks((prev) => ({ ...prev, video: false }));

      if (virtualBackgroundManager) {
        await virtualBackgroundManager.disable();
        setVirtualBackgroundEnabled(false);
      }
    } else {
      await room.localParticipant.setCameraEnabled(true);
      setLocalTracks((prev) => ({ ...prev, video: true }));

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

            if (!virtualBackgroundManager) {
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
              }, 500);
            }
          }
        }
      } catch (_e) {}
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
        try {
          await room.startAudio();
          setAudioPlaybackReady(true);
        } catch {
          setAudioPlaybackReady(false);
        }

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

  const hasActiveAudio = (participant: RemoteParticipantInfo) => {
    return participant.audioTrack !== null && !participant.audioTrack.isMuted;
  };

  const leaveRoom = async () => {
    try {
      console.log("Leaving room...");

      if (room) {
        await room.disconnect();
        console.log("Disconnected from LiveKit room");
      }

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

      window.location.href = "/admin/create-session";
    } catch (error) {
      console.error("Error leaving room:", error);
      window.location.href = "/admin/create-session";
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type === "application/pdf") {
      await handlePdfUpload(event);
      return;
    }

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];
    const maxSize = 10 * 1024 * 1024;

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
        await convertFile(data.filename);
      } else {
        if (response.status === 422 && data.details) {
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

        setTimeout(() => {
          addImageToWhiteboard(data.url!, convertedImages.length);
        }, 1000);
      } else {
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
        if (screenShareTrack) {
          await room.localParticipant.unpublishTrack(screenShareTrack);
          setScreenShareTrack(null);
        }
        setIsScreenSharing(false);
        console.log("Screen sharing stopped");
      } else {
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

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please upload a PDF file");
      if (e.target) e.target.value = "";
      return;
    }

    setIsPdfProcessing(true);
    setError(null);

    try {
      const pageUrls = await pdfToImages(file, 2);
      console.log(
        "pageUrls from pdfToImages:",
        pageUrls,
        "length:",
        pageUrls.length
      );
      if (pageUrls.length === 0) {
        setError("No pages found in PDF");
        return;
      }
      const editor = editorRef.current;
      console.log("Editor in handlePdfUpload:", !!editor);
      if (!editor) return;

      if (frameIdRef.current) {
        try {
          editor.deleteShapes([frameIdRef.current]);
        } catch {
          /* ignore */
        }
      }
      resetViewer();

      const firstImg = await loadImage(pageUrls[0]);
      const frameW = Math.min(1000, firstImg.width);
      const frameH = Math.min(
        720,
        Math.max(520, Math.floor(firstImg.height * 0.85))
      );

      const frameId = createShapeId() as TLShapeId;
      editor.createShape({
        id: frameId,
        type: "frame",
        x: 80,
        y: 80,
        props: { w: frameW, h: frameH, name: "PDF Viewer" },
      });

      const contentGroupId = createShapeId() as TLShapeId;
      editor.createShape({
        id: contentGroupId,
        type: "group",
        parentId: frameId as TLParentId,
        x: 0,
        y: 0,
        isLocked: false,
      });

      frameIdRef.current = frameId;
      contentGroupIdRef.current = contentGroupId;
      setViewerSize({ w: frameW, h: frameH });
      console.log("ViewerSize set:", { w: frameW, h: frameH });

      let yOffset = 0;
      const gap = 24;
      const groups: {
        id: TLShapeId;
        y: number;
        w: number;
        h: number;
        url: string;
      }[] = [];

      for (let i = 0; i < pageUrls.length; i++) {
        const url = pageUrls[i];
        const img = await loadImage(url);

        const pageW = frameW;
        const pageH = Math.round((img.height / img.width) * pageW);

        const assetId = createAssetId(`pdf-${i}`);
        const pageGroupId = createShapeId() as TLShapeId;
        const imageId = createShapeId() as TLShapeId;

        editor.createAssets([
          {
            id: assetId as any,
            type: "image",
            typeName: "asset",
            props: {
              name: `PDF Page ${i + 1}`,
              src: url,
              w: pageW,
              h: pageH,
              mimeType: "image/jpeg",
              isAnimated: false,
            },
            meta: {},
          },
        ]);

        editor.createShape({
          id: pageGroupId,
          type: "group",
          parentId: contentGroupId as TLParentId,
          x: 0,
          y: yOffset,
          isLocked: false,
        });

        editor.createShape({
          id: imageId,
          type: "image",
          parentId: pageGroupId as TLParentId,
          x: 0,
          y: 0,
          props: {
            w: pageW,
            h: pageH,
            assetId: assetId as any,
          },
        });

        groups.push({ id: pageGroupId, y: yOffset, w: pageW, h: pageH, url });
        yOffset += pageH + gap;
      }
      console.log("Groups after loop:", groups, "yOffset:", yOffset);
      setPageGroups(groups);
      console.log("PageGroups set:", groups);
      setContentHeight(Math.max(0, yOffset - gap));
      console.log(
        "PageGroups set:",
        groups,
        "ContentHeight set:",
        Math.max(0, yOffset - gap)
      );
      console.log("ContentHeight set:", Math.max(0, yOffset - gap));
      setScroll(0);

      editor.updateShape({
        id: contentGroupId,
        type: "group",
        x: 0,
        y: 0,
      });

      requestAnimationFrame(() => updateOverlayFromFrame(true));
    } catch (err) {
      console.error("PDF load error:", err); // Already hai, lekin detailed log add kar
      setError("Failed to load PDF");
    } finally {
      setIsPdfProcessing(false);
      if (e.target) e.target.value = "";
    }
  };

  const resetViewer = useCallback(() => {
    frameIdRef.current = null;
    contentGroupIdRef.current = null;
    setPageGroups([]);
    setContentHeight(0);
    setViewerSize(null);
    setScroll(0);
    setIsMinimized(false);
    setOverlayStyle(null);
    setToolbarStyle(null);
  }, []);

  const setFrameSize = useCallback((w: number, h: number) => {
    const editor = editorRef.current;
    const frameId = frameIdRef.current;
    if (!editor || !frameId) return;
    const frame = editor.getShape(frameId) as any;
    if (!frame) return;
    editor.updateShape({
      id: frameId,
      type: "frame",
      props: {
        ...(frame.props || {}),
        w,
        h,
        name: frame.props?.name || "PDF Viewer",
      },
    });
    setViewerSize({ w, h });
  }, []);

  const applyScroll = useCallback(
    (next: number) => {
      const editor = editorRef.current;
      const contentGroupId = contentGroupIdRef.current;
      if (!editor || !contentGroupId || !viewerSize) return;

      const maxScroll = Math.max(0, contentHeight - viewerSize.h);
      const clamped = Math.max(0, Math.min(maxScroll, next));
      setScroll(clamped);

      editor.updateShape({
        id: contentGroupId,
        type: "group",
        x: 0,
        y: -clamped,
      });
    },
    [contentHeight, viewerSize]
  );

  const onHtmlScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    applyScroll(el.scrollTop);
  }, [applyScroll]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - scroll) > 1) {
      el.scrollTop = scroll;
    }
  }, [scroll]);

  const updateOverlayFromFrame = useCallback((force = false) => {
    console.log("updateOverlayFromFrame called, force:", force);
    const editor = editorRef.current;
    console.log("Editor available:", !!editor);
    const frameId = frameIdRef.current;
    console.log("Frame ID available:", !!frameId);
    if (!editor || !frameId) {
      console.log("Editor or frameId not available, resetting overlayStyle");
      if (overlayStyle) setOverlayStyle(null);
      if (toolbarStyle) setToolbarStyle(null);
      return;
    }
    const b = editor.getShapePageBounds(frameId);
    console.log("Bounds:", b);
    if (!b) {
      console.log("Bounds not available, resetting overlayStyle");
      if (overlayStyle) setOverlayStyle(null);
      return;
    }

    const tl = pagePointToViewport(editor, b.x, b.y);
    const br = pagePointToViewport(editor, b.x + b.w, b.y + b.h);

    const left = Math.min(tl.x, br.x);
    const top = Math.min(tl.y, br.y);
    const width = Math.abs(br.x - tl.x);
    const height = Math.abs(br.y - tl.y);

    if (
      force ||
      !overlayStyle ||
      left !== overlayStyle.left ||
      top !== overlayStyle.top ||
      width !== overlayStyle.width ||
      height !== overlayStyle.height
    ) {
      setOverlayStyle({
        position: "absolute",
        left,
        top,
        width,
        height,
        pointerEvents: "none",
        zIndex: 5,
      });
      setToolbarStyle({
        position: "absolute",
        left,
        top: top - 70,
        width,
        height: 32,
        display: "flex",
        alignItems: "center",
        paddingLeft: 8,
        gap: 8,
        pointerEvents: "auto",
        zIndex: 6,
      });
    }
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const dispose =
      (editor.store as any).listen?.(
        () => {
          updateOverlayFromFrame();
        },
        { scope: "all" }
      ) ??
      (() => {
        const id = window.setInterval(() => updateOverlayFromFrame(), 200);
        return () => window.clearInterval(id);
      });

    updateOverlayFromFrame(true);

    return () => {
      try {
        dispose && dispose();
      } catch {
        /* ignore */
      }
    };
  }, [updateOverlayFromFrame]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      updateOverlayFromFrame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [updateOverlayFromFrame]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const isAnnotation = (type: string) =>
      type !== "group" && type !== "image" && type !== "frame";

    const stickById = (shapeId: TLShapeId) => {
      const contentGroupId = contentGroupIdRef.current;
      const frameId = frameIdRef.current;
      if (!contentGroupId || !frameId) return;

      const shape = editor.getShape(shapeId) as any;
      if (!shape || !isAnnotation(shape.type)) return;

      const frameBounds = editor.getShapePageBounds(frameId);
      const shapeBounds = editor.getShapePageBounds(shapeId);
      if (!frameBounds || !shapeBounds) return;

      const frameTopWorldY = frameBounds.y;
      const yMid = shapeBounds.y + shapeBounds.h / 2;
      const contentSpaceY = yMid - frameTopWorldY + scroll;

      const page = pageGroups.find(
        (p) => contentSpaceY >= p.y && contentSpaceY <= p.y + p.h
      );
      const targetParent = (page?.id ?? contentGroupId) as TLParentId;

      if ((shape as any).parentId !== targetParent) {
        (editor as any).reparentShapes?.([shapeId], targetParent);
        editor.updateShape({ id: shapeId, type: shape.type, isLocked: false });
      }
    };

    const offAfterCreate =
      (editor as any).sideEffects?.registerAfterCreateHandler?.(
        "shape",
        (record: any) => {
          if (isAnnotation(record.type)) stickById(record.id as TLShapeId);
        }
      ) ?? (() => {});

    const offAfterChange =
      (editor as any).sideEffects?.registerAfterChangeHandler?.(
        "shape",
        (_before: any, after: any) => {
          if (isAnnotation(after.type)) stickById(after.id as TLShapeId);
        }
      ) ?? (() => {});

    const offAfterDelete =
      (editor as any).sideEffects?.registerAfterDeleteHandler?.(
        "shape",
        (record: any) => {
          const frameId = frameIdRef.current;
          const contentGroupId = contentGroupIdRef.current;
          if (record?.id === frameId || record?.id === contentGroupId) {
            resetViewer();
          }
        }
      ) ?? (() => {});

    return () => {
      try {
        typeof offAfterCreate === "function" && offAfterCreate();
        typeof offAfterChange === "function" && offAfterChange();
        typeof offAfterDelete === "function" && offAfterDelete();
      } catch {
        /* ignore */
      }
    };
  }, [pageGroups, scroll, resetViewer]);

  if (error) {
    const isEncryptedPdfError =
      error.includes("encrypted") || error.includes("password");
    console.log(
      "Rendering Check - overlayStyle:",
      overlayStyle,
      "viewerSize:",
      viewerSize,
      "pageGroups.length:",
      pageGroups ? pageGroups.length : 0
    );
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
      <div className="top-bar">
        <div className="logo-section">
          <img
            src="https://moalimy.com/public/front_assets/images/logo_home_new.png"
            alt="Logo"
            style={{
              height: 65,
            }}
          />
          <div className="subject-name">
            {session?.subject || "Loading Subject..."}
          </div>
        </div>

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

      <div className="main-content">
        <div className="whiteboard-area">
          <div style={{ position: "relative", flex: 1 }}>
            <CustomTldraw
              store={syncStore}
              autoFocus
              onMount={(editor: Editor) => {
                editorRef.current = editor;
                setTimeout(() => updateOverlayFromFrame(true), 50);
              }}
            />
            {toolbarStyle && viewerSize && pageGroups.length > 0 && (
              <div style={toolbarStyle}>
                <div
                  style={{
                    height: 32,
                    width: "100%",
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: 8,
                    padding: "0 8px",
                  }}
                >
                  <button
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 14,
                      background: "#f4c542",
                      border: "none",
                      cursor: "pointer",
                    }}
                    title="Minimize"
                    onClick={() => {
                      if (!viewerSize) return;
                      if (!isMinimized) {
                        prevSizeRef.current = viewerSize;
                        setFrameSize(viewerSize.w, 48);
                        setIsMinimized(true);
                      } else {
                        const prev = prevSizeRef.current || { w: 800, h: 600 };
                        setFrameSize(prev.w, prev.h);
                        setIsMinimized(false);
                      }
                    }}
                  />
                  <button
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 14,
                      background: "#f44336",
                      border: "none",
                      cursor: "pointer",
                    }}
                    title="Close"
                    onClick={() => {
                      const editor = editorRef.current;
                      const frameId = frameIdRef.current;
                      if (!editor || !frameId) return;
                      try {
                        editor.deleteShapes([frameId]);
                      } catch {}
                      resetViewer();
                    }}
                  />
                </div>
              </div>
            )}

            {overlayStyle && viewerSize && pageGroups.length > 0 && (
              <div style={overlayStyle}>
                <div
                  ref={scrollerRef}
                  onScroll={onHtmlScroll}
                  style={{
                    pointerEvents: "auto",
                    position: "absolute",
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: 16,
                    overflowY: "auto",
                    overflowX: "hidden",
                    background: "rgba(0, 0, 0, 0.1)", // Visible for debugging
                    zIndex: 6,
                  }}
                >
                  <div style={{ width: 1, height: contentHeight }} />
                </div>
              </div>
            )}
          </div>

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

        <div className="right-sidebar">
          <div className="participant-panels">
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

        {role !== "student" && (
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
        )}

        {role !== "student" && (
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
        )}

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

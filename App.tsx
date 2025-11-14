

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { ImageAdjustments } from './types';
import { 
    BrushIcon, WandIcon, BrightnessIcon, ContrastIcon, SaturationIcon, 
    HueIcon, BlurIcon, GrayscaleIcon, SepiaIcon, InvertIcon, 
    DownloadIcon, UndoIcon, NewImageIcon, ResetValueIcon,
    AIInpaintLogo, RedoIcon, VignetteIcon, EraserIcon,
    PlusIcon, CloseIcon, FolderIcon, ClearIcon, FilmIcon, SlidersIcon,
    PhotoIcon, FolderStackIcon, BackIcon, WatermarkIcon, SpinnerIcon,
    PaletteIcon, RegenerateIcon
} from './components/icons';

// Fix: Add module augmentation for non-standard input properties to fix TypeScript error.
// Using `declare global` to avoid potential module resolution issues with some tooling.
declare global {
    namespace React {
        interface InputHTMLAttributes<T> {
            webkitdirectory?: string;
        }
    }
}

declare var JSZip: any;

const initialAdjustments: ImageAdjustments = {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hue: 0,
    blur: 0,
    grayscale: 0,
    sepia: 0,
    invert: 0,
    vignette: 0,
};

type WatermarkMode = 'center' | 'diagonal' | 'line' | 'grid';

const lutGroups: { title: string, luts: { name: string, adjustments: ImageAdjustments }[] }[] = [
    {
        title: 'Cơ bản',
        luts: [
            { name: 'None', adjustments: initialAdjustments },
            { name: 'Vintage', adjustments: { ...initialAdjustments, brightness: 105, contrast: 90, saturation: 85, sepia: 25 } },
            { name: 'Cinematic', adjustments: { ...initialAdjustments, brightness: 95, contrast: 120, saturation: 80, hue: -10, sepia: 15 } },
            { name: 'B&W', adjustments: { ...initialAdjustments, contrast: 110, grayscale: 100, saturation: 0 } },
            { name: 'Cool', adjustments: { ...initialAdjustments, brightness: 102, contrast: 105, saturation: 90, hue: 15 } },
            { name: 'Warm', adjustments: { ...initialAdjustments, brightness: 105, contrast: 110, saturation: 110, hue: -5, sepia: 10 } },
        ]
    },
    {
        title: 'Phong cách đạo diễn',
        luts: [
            { name: 'Wes Anderson', adjustments: { ...initialAdjustments, brightness: 105, contrast: 95, saturation: 115, sepia: 10, hue: 5 } },
            { name: 'C. Nolan', adjustments: { ...initialAdjustments, brightness: 95, contrast: 130, saturation: 85, grayscale: 15 } },
            { name: 'D. Villeneuve', adjustments: { ...initialAdjustments, brightness: 105, contrast: 115, saturation: 70, sepia: 35, hue: -5 } },
            { name: 'Tarantino', adjustments: { ...initialAdjustments, brightness: 102, contrast: 115, saturation: 135, sepia: 15, hue: -3 } },
            { name: 'The Matrix', adjustments: { ...initialAdjustments, brightness: 90, contrast: 140, saturation: 110, hue: 90, grayscale: 30 } },
            { name: 'Amélie', adjustments: { ...initialAdjustments, brightness: 100, contrast: 115, saturation: 140, sepia: 25, hue: -8 } },
        ]
    }
];

// Helper component for adjustment sliders
interface AdjustmentSliderProps {
    label: string;
    icon: React.ReactNode;
    value: number;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    min: number;
    max: number;
    defaultValue: number;
    onReset: () => void;
}

const AdjustmentSlider: React.FC<AdjustmentSliderProps> = ({ label, icon, value, onChange, min, max, defaultValue, onReset }) => (
    <div className="flex flex-col space-y-2">
        <div className="flex items-center justify-between text-sm">
            <div className="flex items-center space-x-2">
                {icon}
                <label className="text-[var(--text-secondary)] font-medium">{label}</label>
            </div>
            <div className="flex items-center space-x-2">
                <span className="text-[var(--text-tertiary)] w-8 text-right">{value}</span>
                <button onClick={onReset} title={`Reset ${label}`} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors p-1 rounded-full hover:bg-[var(--bg-gradient-end)]">
                    <ResetValueIcon />
                </button>
            </div>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            value={value}
            defaultValue={defaultValue}
            onChange={onChange}
            className="w-full"
        />
    </div>
);

const Section = ({ title, icon, children }: { title: string, icon: React.ReactNode, children?: React.ReactNode }) => (
    <div className="panel">
        <div className="flex items-center space-x-3 mb-6">
            {icon}
            <h3 className="text-lg font-semibold text-[var(--text-secondary)]">{title}</h3>
        </div>
        <div className="space-y-6">
            {children}
        </div>
    </div>
);


export default function App() {
    const [mode, setMode] = useState<'selection' | 'edit' | 'batch'>('selection');
    const [activeEditTab, setActiveEditTab] = useState<'ai' | 'style' | 'filters' | 'adjustments'>('ai');
    const [originalUserImage, setOriginalUserImage] = useState<string | null>(null); // Stores the current base image for edits
    const [displayImage, setDisplayImage] = useState<string | null>(null); // Stores the image with CSS filters for display
    const [prompt, setPrompt] = useState<string>('');
    const [brushSize, setBrushSize] = useState<number>(37);
    const [maxBrushSize, setMaxBrushSize] = useState<number>(100);
    const [adjustments, setAdjustments] = useState<ImageAdjustments>(initialAdjustments);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [status, setStatus] = useState<string>('Sẵn sàng');
    const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
    const [activeLut, setActiveLut] = useState<string>('None');
    const [undoState, setUndoState] = useState<{ image: string | null; adjustments: ImageAdjustments; originalImage: string | null; } | null>(null);
    const [isRedo, setIsRedo] = useState<boolean>(false);
    const [referenceImages, setReferenceImages] = useState<(string | null)[]>([null, null, null]);
    const [refDragOverIndex, setRefDragOverIndex] = useState<number | null>(null);
    const [batchImages, setBatchImages] = useState<Array<{ id: number; name: string; original: string; processed: string | null; isLoading: boolean }>>([]);
    const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);

    const [lastUsedPrompt, setLastUsedPrompt] = useState<string>('');
    const [showRegenerate, setShowRegenerate] = useState<boolean>(false);
    const [activeStyle, setActiveStyle] = useState<string | null>(null);
    
    // Watermark states
    const [originalWatermarkImage, setOriginalWatermarkImage] = useState<string | null>(null);
    const [watermarkImage, setWatermarkImage] = useState<string | null>(null);
    const [watermarkSettings, setWatermarkSettings] = useState({
        mode: 'center' as WatermarkMode,
        size: 30, // percentage
        opacity: 20, // percentage
    });
    const [removeLogoBg, setRemoveLogoBg] = useState(false);
    const [isRemovingLogoBg, setIsRemovingLogoBg] = useState(false);
    
    const imageRef = useRef<HTMLImageElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const isDrawing = useRef<boolean>(false);
    const isErasing = useRef<boolean>(false);
    const lastPos = useRef<{ x: number; y: number } | null>(null);
    const brushCursorRef = useRef<HTMLDivElement>(null);
    const isResizingBrush = useRef(false);
    const brushResizeStartPos = useRef({ x: 0 });

    const applyFilters = useCallback(() => {
        const { brightness, contrast, saturation, hue, blur, grayscale, sepia, invert } = adjustments;
        return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg) blur(${blur}px) grayscale(${grayscale}%) sepia(${sepia}%) invert(${invert}%)`;
    }, [adjustments]);

    const saveUndoState = useCallback(() => {
        setUndoState({ image: displayImage, adjustments, originalImage: originalUserImage });
        setIsRedo(false);
    }, [displayImage, adjustments, originalUserImage]);

    const processFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result as string;
            setOriginalUserImage(result);
            setDisplayImage(result);
            setAdjustments(initialAdjustments);
            setActiveLut('None');
            setUndoState(null);
            setIsRedo(false);
            clearCanvas();
            setShowRegenerate(false);
            setLastUsedPrompt('');
        };
        reader.readAsDataURL(file);
    };

    const handleFileSelectForEdit = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            processFile(e.target.files[0]);
            setMode('edit');
        }
    };
    
    const handleReferenceImageChange = (file: File, index: number) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result as string;
            setReferenceImages(prev => {
                const newImages = [...prev];
                newImages[index] = result;
                return newImages;
            });
        };
        reader.readAsDataURL(file);
    };
    
    const removeReferenceImage = (index: number) => {
        setReferenceImages(prev => {
            const newImages = [...prev];
            newImages[index] = null;
            return newImages;
        });
    };

    const handleAdjustmentChange = (key: keyof ImageAdjustments, value: string) => {
        setAdjustments(prev => ({ ...prev, [key]: Number(value) }));
        setActiveLut('Custom');
    };

    const handleResetSingleAdjustment = (key: keyof ImageAdjustments) => {
        setAdjustments(prev => ({
            ...prev,
            [key]: initialAdjustments[key]
        }));
        setActiveLut('Custom');
    };

    const applyWatermark = useCallback((baseImageUrl: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            if (!watermarkImage) {
                resolve(baseImageUrl);
                return;
            }
    
            const baseImg = new Image();
            baseImg.crossOrigin = "anonymous";
            baseImg.onload = () => {
                const watermarkImg = new Image();
                watermarkImg.crossOrigin = "anonymous";
                watermarkImg.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = baseImg.naturalWidth;
                    canvas.height = baseImg.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return reject(new Error('Could not get canvas context'));
    
                    ctx.drawImage(baseImg, 0, 0);
    
                    ctx.globalAlpha = watermarkSettings.opacity / 100;
                    const shorterDim = Math.min(canvas.width, canvas.height);
                    const watermarkTargetWidth = shorterDim * (watermarkSettings.size / 100);
                    const scale = watermarkTargetWidth / watermarkImg.naturalWidth;
                    const w = watermarkImg.naturalWidth * scale;
                    const h = watermarkImg.naturalHeight * scale;
    
                    const drawWatermark = (x: number, y: number, rotation = 0) => {
                        ctx.save();
                        ctx.translate(x, y);
                        ctx.rotate(rotation);
                        ctx.drawImage(watermarkImg, -w / 2, -h / 2, w, h);
                        ctx.restore();
                    };
    
                    switch (watermarkSettings.mode) {
                        case 'center':
                            drawWatermark(canvas.width / 2, canvas.height / 2);
                            break;
                        case 'diagonal':
                            drawWatermark(canvas.width / 2, canvas.height / 2, -Math.PI / 4);
                            break;
                        case 'line': {
                            const diagonalLength = Math.sqrt(canvas.width ** 2 + canvas.height ** 2);
                            const spacing = w * 1.5;
                            const count = Math.floor(diagonalLength / spacing) + 4;
                            const angle = -Math.PI / 4;
                            for (let i = 0; i < count; i++) {
                                const pos = -diagonalLength / 2 + (i-1) * spacing;
                                const x = canvas.width / 2 + pos * Math.cos(angle);
                                const y = canvas.height / 2 + pos * Math.sin(angle);
                                drawWatermark(x, y, angle);
                            }
                            break;
                        }
                        case 'grid': {
                            const paddingX = w;
                            const paddingY = h * 1.5;
                            for (let y = -h; y < canvas.height + h; y += h + paddingY) {
                                for (let x = -w; x < canvas.width + w; x += w + paddingX) {
                                    drawWatermark(x, y, -Math.PI / 12);
                                }
                            }
                            break;
                        }
                    }
                    resolve(canvas.toDataURL('image/png'));
                };
                watermarkImg.onerror = () => reject(new Error('Could not load watermark image'));
                watermarkImg.src = watermarkImage;
            };
            baseImg.onerror = () => reject(new Error('Could not load base image'));
            baseImg.src = baseImageUrl;
        });
    }, [watermarkImage, watermarkSettings]);
    
    const applyLutToImage = useCallback((imageUrl: string, adjustmentsToApply: ImageAdjustments): Promise<string> => {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Could not get canvas context'));
    
                const { brightness, contrast, saturation, hue, blur, grayscale, sepia, invert, vignette } = adjustmentsToApply;
                ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg) blur(${blur}px) grayscale(${grayscale}%) sepia(${sepia}%) invert(${invert}%)`;
                
                ctx.drawImage(image, 0, 0);
    
                if (vignette > 0) {
                    const gradient = ctx.createRadialGradient(
                        canvas.width / 2, canvas.height / 2, canvas.width * 0.4,
                        canvas.width / 2, canvas.height / 2, canvas.width / 2
                    );
                    gradient.addColorStop(0, 'rgba(0,0,0,0)');
                    gradient.addColorStop(1, `rgba(0,0,0,${vignette / 100 * 0.8})`);
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
                resolve(canvas.toDataURL('image/png'));
            };
            image.onerror = () => reject(new Error('Could not load image'));
            image.src = imageUrl;
        });
    }, []);

    const handleApplyLut = (lut: { name: string, adjustments: ImageAdjustments }) => {
        if (displayImage && mode === 'edit') {
            saveUndoState();
        }
        setAdjustments(lut.adjustments);
        setActiveLut(lut.name);
    };
    
    const removeWatermarkBackground = useCallback(async () => {
        if (!originalWatermarkImage) return;
        setIsRemovingLogoBg(true);
        setStatus('Đang xóa nền logo...');
        try {
            if (!process.env.API_KEY) throw new Error("API key not found.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const [header, data] = originalWatermarkImage.split(',');
            const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
    
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: {
                    parts: [
                        { inlineData: { data, mimeType } },
                        { text: 'Your task is to act as an expert graphic designer. The user has provided an image of a logo. Remove the background from this logo, making it transparent. The logo itself should remain unchanged, with sharp and clean edges. Output only the processed image with a transparent background.' }
                    ]
                },
                config: { responseModalities: [Modality.IMAGE] }
            });
            const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (imagePart?.inlineData?.data) {
                setWatermarkImage(`data:image/png;base64,${imagePart.inlineData.data}`);
            } else {
                throw new Error('AI không thể xử lý logo.');
            }
        } catch (e: any) {
            console.error("Lỗi xóa nền logo:", e);
            const msg = e.message || 'Lỗi xóa nền logo.';
            setStatus(`Lỗi: ${msg}`);
            setWatermarkImage(originalWatermarkImage); // Fallback
        } finally {
            setIsRemovingLogoBg(false);
            setStatus('Sẵn sàng');
        }
    }, [originalWatermarkImage]);
    
    useEffect(() => {
        if (removeLogoBg && originalWatermarkImage) {
            removeWatermarkBackground();
        } else {
            setWatermarkImage(originalWatermarkImage);
        }
    }, [removeLogoBg, originalWatermarkImage, removeWatermarkBackground]);
    
    // This effect will handle real-time updates for batch processing
    useEffect(() => {
        if (mode !== 'batch' || batchImages.length === 0) {
            return;
        }
    
        const handler = setTimeout(async () => {
            setIsBatchProcessing(true);
            setStatus(`Đang xử lý hàng loạt ${batchImages.length} ảnh...`);
    
            const processingPromises = batchImages.map(image =>
                applyLutToImage(image.original, adjustments)
                    .then(processedUrl => applyWatermark(processedUrl))
                    .then(finalUrl => ({ id: image.id, processed: finalUrl }))
                    .catch(error => {
                        console.error(`Error processing ${image.name}:`, error);
                        return { id: image.id, processed: image.original };
                    })
            );
    
            const results = await Promise.all(processingPromises);
    
            setBatchImages(prev => {
                let hasChanged = false;
                const newBatchImages = prev.map(img => {
                    const result = results.find(r => r.id === img.id);
                    const newProcessedUrl = result?.processed ?? img.original;
                    if (img.processed !== newProcessedUrl) {
                        hasChanged = true;
                    }
                    return {
                        ...img,
                        processed: newProcessedUrl,
                        isLoading: false
                    };
                });

                if (!hasChanged && prev.length === batchImages.length) {
                    return prev; 
                }
                
                return newBatchImages;
            });
            
            setIsBatchProcessing(false);
            setStatus('Xử lý hàng loạt hoàn tất!');
        }, 300);
    
        return () => {
            clearTimeout(handler);
        };
    }, [adjustments, applyLutToImage, applyWatermark, mode, batchImages, watermarkImage, watermarkSettings]);
    
    const handleWatermarkUpload = (file: File) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result as string;
            setOriginalWatermarkImage(result);
            setWatermarkImage(result);
            setRemoveLogoBg(false);
        };
        reader.readAsDataURL(file);
    };

    const clearCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
        const maskCanvas = maskCanvasRef.current;
        if (maskCanvas) {
            const maskCtx = maskCanvas.getContext('2d');
            maskCtx?.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        }
    }, []);
    
    const getCanvasCoordinates = useCallback((e: {clientX: number, clientY: number}): { x: number, y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width * canvas.width,
            y: (e.clientY - rect.top) / rect.height * canvas.height
        };
    }, []);

    const draw = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (!isDrawing.current || isResizingBrush.current) return;
        const currentPos = getCanvasCoordinates(e);
        if (lastPos.current && currentPos) {
            const visualCtx = canvasRef.current?.getContext('2d');
            const maskCtx = maskCanvasRef.current?.getContext('2d');

            // Draw on visual canvas (the one the user sees)
            if (visualCtx) {
                const originalGCO = visualCtx.globalCompositeOperation;
                visualCtx.globalCompositeOperation = isErasing.current ? 'destination-out' : 'source-over';
                visualCtx.strokeStyle = '#A78BFA'; // Light Purple
                visualCtx.lineWidth = brushSize;
                visualCtx.lineCap = 'round';
                visualCtx.lineJoin = 'round';
                visualCtx.beginPath();
                visualCtx.moveTo(lastPos.current!.x, lastPos.current!.y);
                visualCtx.lineTo(currentPos.x, currentPos.y);
                visualCtx.stroke();
                visualCtx.globalCompositeOperation = originalGCO;
            }

            // Draw on mask canvas (the one used for processing)
            if (maskCtx) {
                const originalGCO = maskCtx.globalCompositeOperation;
                maskCtx.globalCompositeOperation = isErasing.current ? 'destination-out' : 'source-over';
                maskCtx.strokeStyle = 'white'; // Mask is always white for alpha
                maskCtx.lineWidth = brushSize;
                maskCtx.lineCap = 'round';
                maskCtx.lineJoin = 'round';
                maskCtx.beginPath();
                maskCtx.moveTo(lastPos.current!.x, lastPos.current!.y);
                maskCtx.lineTo(currentPos.x, currentPos.y);
                maskCtx.stroke();
                maskCtx.globalCompositeOperation = originalGCO;
            }

            lastPos.current = currentPos;
        }
    }, [brushSize, getCanvasCoordinates]);

    const handleMouseUp = useCallback((e: MouseEvent) => {
        isDrawing.current = false;
        isErasing.current = false;
        lastPos.current = null;
        window.removeEventListener('mouseup', handleMouseUp);
        
        const canvas = canvasRef.current;
        if (canvas && brushCursorRef.current) {
            const rect = canvas.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                brushCursorRef.current.style.opacity = '0';
            }
        }
    }, []);

    const startDrawing = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (isResizingBrush.current) return;
        isDrawing.current = true;
        lastPos.current = getCanvasCoordinates(e);
        window.addEventListener('mouseup', handleMouseUp, { once: true });
    }, [getCanvasCoordinates, handleMouseUp]);

    const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isDrawing.current) {
            draw(e);
        }
        if (!brushCursorRef.current || !imageRef.current) return;
        
        const containerRect = e.currentTarget.getBoundingClientRect();
        const scale = imageRef.current.clientWidth / imageRef.current.naturalWidth;
        const scaledBrushSize = brushSize * scale;

        brushCursorRef.current.style.width = `${scaledBrushSize}px`;
        brushCursorRef.current.style.height = `${scaledBrushSize}px`;
        brushCursorRef.current.style.left = `${e.clientX - containerRect.left}px`;
        brushCursorRef.current.style.top = `${e.clientY - containerRect.top}px`;
        
        if (isErasing.current) {
            brushCursorRef.current.style.backgroundColor = 'rgba(239, 68, 68, 0.5)'; // red-500
            brushCursorRef.current.style.borderColor = 'white';
        } else {
            brushCursorRef.current.style.backgroundColor = 'rgba(167, 139, 250, 0.5)'; // light purple
            brushCursorRef.current.style.borderColor = 'white';
        }
    };

    const handleBrushResizeMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizingBrush.current) return;
        const dx = e.clientX - brushResizeStartPos.current.x;
        brushResizeStartPos.current.x = e.clientX;
        setBrushSize(prevSize => {
            const newSize = prevSize + dx * 0.5;
            return Math.max(1, Math.min(maxBrushSize, Math.round(newSize)));
        });
    }, [maxBrushSize]);

    const handleBrushResizeMouseUp = useCallback((e: MouseEvent) => {
        if (e.button === 2) {
            isResizingBrush.current = false;
            window.removeEventListener('mousemove', handleBrushResizeMouseMove);
            window.removeEventListener('mouseup', handleBrushResizeMouseUp);

            const canvas = canvasRef.current;
             if (canvas && brushCursorRef.current) {
                const rect = canvas.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                    brushCursorRef.current.style.opacity = '0';
                }
            }
        }
    }, [handleBrushResizeMouseMove]);

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button === 0) { // Left click to draw
            isErasing.current = false;
            startDrawing(e);
        } else if (e.button === 2) { // Right click
            e.preventDefault();
            if (e.altKey) { // Alt + Right click to resize
                isResizingBrush.current = true;
                brushResizeStartPos.current = { x: e.clientX };
                window.addEventListener('mousemove', handleBrushResizeMouseMove);
                window.addEventListener('mouseup', handleBrushResizeMouseUp);
            } else { // Right click to erase
                isErasing.current = true;
                startDrawing(e);
            }
        }
    };
    
    const handleContainerMouseEnter = () => {
        if (brushCursorRef.current) brushCursorRef.current.style.opacity = '1';
    };

    const handleContainerMouseLeave = () => {
        if (!isDrawing.current && !isResizingBrush.current && brushCursorRef.current) {
            brushCursorRef.current.style.opacity = '0';
        }
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (canvas && image && displayImage) {
            const setCanvasAndBrushSize = () => {
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;

                const smallerDim = Math.min(image.naturalWidth, image.naturalHeight);
                const newMaxBrushSize = Math.max(50, Math.round(smallerDim * 0.2));
                setMaxBrushSize(newMaxBrushSize);
                setBrushSize(currentSize => Math.min(currentSize, newMaxBrushSize));

                if (!maskCanvasRef.current) {
                    maskCanvasRef.current = document.createElement('canvas');
                }
                maskCanvasRef.current.width = image.naturalWidth;
                maskCanvasRef.current.height = image.naturalHeight;
            }
            if (image.complete) {
                setCanvasAndBrushSize();
            } else {
                image.onload = setCanvasAndBrushSize;
            }
        }
    }, [displayImage]);

    const handleImageResponse = useCallback((base64Data: string, editMode: 'composite' | 'replace'): Promise<void> => {
        return new Promise((resolve, reject) => {
            if (editMode === 'replace') {
                const newImageBase64 = `data:image/png;base64,${base64Data}`;
                setDisplayImage(newImageBase64);
                setOriginalUserImage(newImageBase64);
                clearCanvas();
                resolve();
                return;
            }

            // 'composite' logic for precise removal
            const generatedImage = new Image();
            generatedImage.crossOrigin = "anonymous";
            generatedImage.onload = () => {
                const baseImage = new Image();
                baseImage.crossOrigin = "anonymous";
                baseImage.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = baseImage.naturalWidth;
                    canvas.height = baseImage.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return reject(new Error('Could not get canvas context for compositing'));
    
                    // Isolate the generated content within the mask.
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = canvas.width;
                    tempCanvas.height = canvas.height;
                    const tempCtx = tempCanvas.getContext('2d');
                    if (!tempCtx) return reject(new Error('Could not get temporary canvas context'));
                    tempCtx.drawImage(generatedImage, 0, 0);
                    tempCtx.globalCompositeOperation = 'destination-in';
                    if (maskCanvasRef.current) {
                        tempCtx.drawImage(maskCanvasRef.current, 0, 0);
                    }
    
                    // Draw the base image (which contains previous edits).
                    ctx.drawImage(baseImage, 0, 0);
    
                    // Draw the isolated generated content on top.
                    ctx.drawImage(tempCanvas, 0, 0);
    
                    const newImageBase64 = canvas.toDataURL('image/png');
                    
                    setDisplayImage(newImageBase64);
                    setOriginalUserImage(newImageBase64); // Update base image for cumulative edits
                    
                    clearCanvas();
                    resolve();
                };
                baseImage.onerror = () => reject(new Error('Failed to load base image for compositing'));
                if (originalUserImage) {
                    baseImage.src = originalUserImage;
                } else {
                    reject(new Error('Original user image not found for compositing'));
                }
            };
            generatedImage.onerror = () => reject(new Error('Failed to load AI-generated image for compositing'));
            generatedImage.src = `data:image/png;base64,${base64Data}`;
        });
    }, [clearCanvas, originalUserImage]);

    const runAIEdit = useCallback(async (inpaintingPrompt: string, useReferenceImages: boolean, editMode: 'composite' | 'replace') => {
        if (!originalUserImage) {
            const msg = 'Vui lòng tải ảnh lên.';
            setStatus(`Lỗi: ${msg}`);
            return;
        }
    
        const maskCanvas = maskCanvasRef.current;
        if (maskCanvas) {
            const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
            if (maskCtx) {
                const pixelBuffer = new Uint32Array(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data.buffer);
                const hasMask = pixelBuffer.some(color => color !== 0);
                if (!hasMask) {
                    const msg = 'Vui lòng vẽ lên ảnh để chọn vùng cần chỉnh sửa.';
                    setStatus(`Lỗi: ${msg}`);
                    return;
                }
            }
        } else {
            const msg = 'Vui lòng vẽ lên ảnh để chọn vùng cần chỉnh sửa.';
            setStatus(`Lỗi: ${msg}`);
            return;
        }
    
        setIsLoading(true);
        setStatus('AI đang xử lý, vui lòng chờ...');
        saveUndoState();
    
        try {
            const punchedOutImageBase64 = await new Promise<string>((resolve, reject) => {
                const image = new Image();
                image.crossOrigin = "anonymous";
                image.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = image.naturalWidth;
                    canvas.height = image.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return reject(new Error('Could not get canvas context for inpainting prep'));
    
                    ctx.drawImage(image, 0, 0);
                    ctx.globalCompositeOperation = 'destination-out';
                    if (maskCanvasRef.current) {
                        ctx.drawImage(maskCanvasRef.current, 0, 0);
                    }
                    resolve(canvas.toDataURL('image/png'));
                };
                image.onerror = () => reject(new Error('Failed to load base image for inpainting prep'));
                image.src = originalUserImage;
            });
    
            if (!process.env.API_KEY) throw new Error("API key not found.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
            const [header, data] = punchedOutImageBase64.split(',');
            const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
    
            const parts: ({ text: string } | { inlineData: { data: string, mimeType: string } })[] = [
                { inlineData: { data, mimeType } },
                { text: inpaintingPrompt }
            ];
    
            if (useReferenceImages) {
                referenceImages.forEach(imgData => {
                    if (imgData) {
                        const [refHeader, refData] = imgData.split(',');
                        const refMimeType = refHeader.match(/:(.*?);/)?.[1] || 'image/png';
                        parts.push({
                            inlineData: { data: refData, mimeType: refMimeType }
                        });
                    }
                });
            }
    
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts },
                config: { responseModalities: [Modality.IMAGE] },
            });
    
            const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (imagePart?.inlineData) {
                await handleImageResponse(imagePart.inlineData.data, editMode);
                setLastUsedPrompt(prompt);
                setShowRegenerate(true);
            } else {
                setShowRegenerate(false);
                throw new Error("Không nhận được ảnh từ AI. Nội dung có thể đã bị chặn.");
            }
        } catch (e: any) {
            console.error(e);
            let msg = 'Đã xảy ra lỗi khi xử lý ảnh.';
            if (e.message?.includes('SAFETY') || e.toString().includes('block')) {
                msg = "Nội dung bị chặn vì vi phạm chính sách an toàn.";
            } else if (e.message) {
                msg = e.message;
            }
            setStatus(`Lỗi: ${msg}`);
            setShowRegenerate(false);
        } finally {
            setIsLoading(false);
            setStatus('Sẵn sàng');
        }
    }, [originalUserImage, referenceImages, saveUndoState, handleImageResponse, prompt]);
    
    const handleRemoveObject = () => {
        setShowRegenerate(false);
        const removalPrompt = `You are an expert photo editor performing a precise removal. You have been given an image with a transparent area marking the target for deletion.

**Your Mission:**
1.  **Analyze Target:** Identify the object(s) or part(s) of objects located strictly *within* the transparent area.
2.  **Precise Removal:** Remove only this identified content.
3.  **Seamless Inpainting:** Fill the resulting transparent gap by intelligently generating pixels based *only* on the immediate surrounding background, textures, and lighting. The goal is a flawless, unnoticeable patch.

**CRUCIAL RULE:** You **MUST NOT** alter, adjust, or change any pixel outside of the original transparent area. The output must be identical to the input, except for the filled-in transparent region.

Output only the final, edited image.`;
        runAIEdit(removalPrompt, false, 'composite');
    };

    const handleGenerate = useCallback(async () => {
        if (!prompt) {
            setStatus('Lỗi: Vui lòng nhập mô tả cho vùng cần thay đổi.');
            return;
        }
        
        const hasReferenceImages = referenceImages.some(img => img !== null);
        let generationPrompt;

        if (hasReferenceImages) {
            generationPrompt = `You are an expert digital artist. You will receive an image with a transparent area, a text prompt, and reference images.

**Your Mission:**
1.  **Identify Focal Point:** The transparent area in the image indicates the primary location for your edit.
2.  **Generate from Prompt & Refs:** Create new content based on the user's text instruction: "${prompt}". Use the provided reference images for style, texture, object, or color inspiration.
3.  **Creative Blending:** Your generated content should be concentrated in and around the transparent area. You have the creative freedom to slightly modify pixels *outside* this area to ensure the new content blends perfectly and seamlessly with the original image's lighting, perspective, and style.

**Final Output:** Output ONLY the final, edited image that merges your generation with the original picture.`;
        } else {
            generationPrompt = `You are an expert photo editor. You have been given an image with a transparent area and a text prompt.

**Your Mission:**
1.  **Identify Focal Point:** The transparent area indicates the primary location for your edit.
2.  **Generate from Prompt:** Create new content inside the image based on the user's instruction: "${prompt}".
3.  **Creative Blending:** Your generated content should be focused on the transparent area, but you are allowed to slightly modify pixels *outside* this area to ensure the new content blends perfectly and seamlessly with the original image's lighting, perspective, and texture.

**Final Output:** Output ONLY the final, edited image that merges your generation with the original picture.`;
        }
        
        runAIEdit(generationPrompt, true, 'replace');
    }, [prompt, referenceImages, runAIEdit]);

    const handleRegenerate = () => {
        if (!lastUsedPrompt) {
            setStatus('Lỗi: Không tìm thấy prompt trước đó để tạo lại.');
            return;
        }
        const regenerationPrompt = `Based on the user's original request: '${lastUsedPrompt}', generate a new, slightly different creative variation. Enhance the details, improve the realism, and ensure the lighting is natural and cinematic. The result should be a high-quality, visually stunning image that adheres to safety policies.`;
    
        runAIEdit(regenerationPrompt, true, 'replace');
    };

    const runStyleTransferAI = useCallback(async (stylePrompt: string) => {
        if (!originalUserImage) {
            setStatus('Lỗi: Vui lòng tải ảnh lên trước.');
            return;
        }
    
        setIsLoading(true);
        setStatus(`Đang áp dụng phong cách...`);
        saveUndoState();
    
        try {
            if (!process.env.API_KEY) throw new Error("API key not found.");
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
            const [header, data] = originalUserImage.split(',');
            const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
    
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: {
                    parts: [
                        { inlineData: { data, mimeType } },
                        { text: stylePrompt }
                    ]
                },
                config: { responseModalities: [Modality.IMAGE] }
            });
    
            const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (imagePart?.inlineData?.data) {
                const newImageBase64 = `data:image/png;base64,${imagePart.inlineData.data}`;
                setDisplayImage(newImageBase64);
                setOriginalUserImage(newImageBase64);
                setShowRegenerate(false);
            } else {
                throw new Error('AI không thể tạo ảnh theo phong cách này.');
            }
        } catch (e: any) {
            console.error("Lỗi chuyển đổi phong cách:", e);
            let msg = "Đã xảy ra lỗi khi chuyển đổi phong cách.";
            if (e.message?.includes('SAFETY')) {
                msg = "Nội dung bị chặn vì vi phạm chính sách an toàn.";
            } else if (e.message) {
                msg = e.message;
            }
            setStatus(`Lỗi: ${msg}`);
        } finally {
            setIsLoading(false);
            setActiveStyle(null);
            setStatus('Sẵn sàng');
        }
    }, [originalUserImage, saveUndoState]);
    
    const handleStyleTransfer = (style: string) => {
        setActiveStyle(style);
        const basePrompt = "You are a master artist specializing in style transformation. Your mission is to completely recreate the source image in the target style. Use the source image **only as a structural blueprint** for composition, object placement, and general outlines. **Do not** simply apply a filter. You must fundamentally change the textures, lighting, materials, and color theory to be entirely authentic to the target style, fully replacing the original's visual properties. Output only the final, recreated image.";
        let stylePrompt = '';
        switch (style) {
            case 'sketch':
                stylePrompt = `${basePrompt} Recreate the source image as a technical engineering blueprint. Render everything with clean, precise vector lines, cross-hatching, and stippling for shading. The final output must look like a professional CAD drawing, completely discarding the original photo's textures and lighting.`;
                break;
            case '3d-render':
                stylePrompt = `${basePrompt} Recreate the source image as a photorealistic 3D scene from a high-end renderer like Octane or V-Ray. Build a new lighting system with global illumination and soft, physically accurate shadows. Replace all original textures with high-quality PBR materials, using the original's color as a starting point but creating realistic roughness, metallic, and specular maps. The final image must look like a cinematic CG shot.`;
                break;
            case 'hyperrealistic':
                stylePrompt = `${basePrompt} Recreate the source image as a hyperrealistic photograph, as if shot with a high-end DSLR. Your task is to render ultra-detailed textures: visible skin pores, fabric weaves, and perfect material surfaces. Create a new, cinematic and natural lighting setup that produces deep contrast and volume. The result must be indistinguishable from a real, professional photograph, completely replacing the original's lighting and surface detail.`;
                break;
            case 'chibi':
                stylePrompt = `${basePrompt} Recreate the source image in the 'Chibi' anime style. Re-imagine the subjects with super-deformed proportions: oversized heads, huge glossy eyes, small bodies. Replace the original's style entirely with a bright, saturated color palette and clean cel-shading. The background must also be redrawn in this cute, simplified aesthetic.`;
                break;
            case 'anime':
                stylePrompt = `${basePrompt} Recreate the source image in a high-quality, modern anime film style (like Makoto Shinkai). Redraw everything with characteristic anime features, a vibrant and emotive color palette, and painterly backgrounds with beautiful 'hikari' lighting effects. Characters must be cel-shaded. The result must look like a frame from a top-tier anime movie, not a filtered photo.`;
                break;
            case '3d-anim':
                stylePrompt = `${basePrompt} Recreate the source image in the style of a modern 3D animated film (like Pixar). Re-model all elements into appealing, stylized 3D forms. Invent new materials, using subsurface scattering for skin, and creating stylized but believable textures for everything else. Design a new, warm, story-telling lighting setup. The final image must be completely redrawn in this 3D animation style.`;
                break;
            case 'claymation':
                stylePrompt = `${basePrompt} Recreate the source image as a claymation scene (like Aardman). Re-sculpt every object from virtual modeling clay. The new textures must be tangible, showing thumbprints, tool marks, and a plasticine finish. Create a new lighting setup that looks like a physical miniature set with practical lights. The result must feel completely handcrafted.`;
                break;
            case 'gongbi':
                stylePrompt = `${basePrompt} Recreate the source image in the classic Chinese 'Gongbi' style. Redraw everything with extremely fine, controlled brushstrokes and sharp outlines. Develop a new, elegant color palette inspired by mineral pigments, built up in layers. The background should be redrawn in a sparse, atmospheric style with ink washes. The entire scene must be transformed onto a virtual silk or rice paper canvas.`;
                break;
        }
        if (stylePrompt) {
            runStyleTransferAI(stylePrompt);
        } else {
            setActiveStyle(null);
        }
    };
    
    // Keyboard shortcut for Generate
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'Enter') {
                if (mode === 'edit' && activeEditTab === 'ai' && !isLoading) {
                    e.preventDefault();
                    handleGenerate();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [mode, activeEditTab, isLoading, handleGenerate]);

    const handleDownload = async () => {
        if (!displayImage) return;
        setIsLoading(true);
        setStatus('Đang chuẩn bị tải xuống...');
        try {
            const finalImage = await applyLutToImage(displayImage, adjustments);
    
            const link = document.createElement('a');
            link.href = finalImage;
            link.download = `edited-image-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch(e: any) {
            console.error("Download error:", e);
            const msg = e.message || "Failed to prepare image for download.";
            setStatus(`Lỗi: ${msg}`);
        } finally {
            setIsLoading(false);
            setStatus('Sẵn sàng');
        }
    };
    
    const handleUndo = () => {
        if (undoState) {
            const redoState = { image: displayImage, adjustments, originalImage: originalUserImage };
            
            setDisplayImage(undoState.image);
            setAdjustments(undoState.adjustments);
            setOriginalUserImage(undoState.originalImage);
            
            setUndoState(redoState);
            setIsRedo(true);
        }
    };

    const handleRedo = () => {
        if(isRedo && undoState) {
            const tempState = { image: displayImage, adjustments, originalImage: originalUserImage };
            setDisplayImage(undoState.image);
            setAdjustments(undoState.adjustments);
            setOriginalUserImage(undoState.originalImage);
            setUndoState(tempState);
        }
    }
    
    const handleNewImage = () => {
        setOriginalUserImage(null);
        setDisplayImage(null);
        setPrompt('');
        setAdjustments(initialAdjustments);
        clearCanvas();
        setUndoState(null);
        setReferenceImages([null, null, null]);
        setMode('selection');
        setStatus('Sẵn sàng');
        setShowRegenerate(false);
        setLastUsedPrompt('');
    };
    
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
    };
    
    const handleDrop = (cb: (files: FileList) => void) => (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            cb(e.dataTransfer.files);
        }
    };
    
    const handleEditDrop = (files: FileList) => {
        if (files[0].type.startsWith('image/')) {
            processFile(files[0]);
            setMode('edit');
        }
    };
    
    const handleWatermarkDrop = (files: FileList) => {
        if (files[0].type.startsWith('image/')) {
            handleWatermarkUpload(files[0]);
        }
    };

    const handleBatchFiles = async (files: FileList | File[]) => {
        const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        const newImages = await Promise.all(imageFiles.map((file, index) => {
            return new Promise<{ id: number; name: string; original: string; processed: string | null; isLoading: boolean }>(resolve => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    resolve({
                        id: Date.now() + index,
                        name: file.name,
                        original: e.target?.result as string,
                        processed: null,
                        isLoading: false,
                    });
                };
                reader.readAsDataURL(file);
            });
        }));
        setBatchImages(prev => [...prev, ...newImages]);
        setMode('batch');
    };
    
    const handleBatchDirectorySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            handleBatchFiles(Array.from(e.target.files));
        }
    };
    
    const handleBatchDrop = (files: FileList) => {
        handleBatchFiles(Array.from(files));
    };
    
    const handleDownloadBatch = async () => {
        setIsBatchProcessing(true);
        setStatus('Đang nén file ZIP...');
        const zip = new JSZip();
        
        const processedImages = batchImages.filter(img => img.processed);
        
        for (const image of processedImages) {
            const response = await fetch(image.processed!);
            const blob = await response.blob();
            const originalName = image.name.substring(0, image.name.lastIndexOf('.'));
            zip.file(`${originalName}_processed.png`, blob);
        }
        
        zip.generateAsync({ type: "blob" }).then(function(content: any) {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `processed_images_${Date.now()}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setIsBatchProcessing(false);
            setStatus('Sẵn sàng');
        });
    };
    
    const handleRefDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        setRefDragOverIndex(index);
    };

    const handleRefDragLeave = (e: React.DragEvent) => {
        setRefDragOverIndex(null);
    };

    const handleRefDrop = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        setRefDragOverIndex(null);
        if (e.dataTransfer.files && e.dataTransfer.files[0] && e.dataTransfer.files[0].type.startsWith('image/')) {
            handleReferenceImageChange(e.dataTransfer.files[0], index);
        }
    };
    
    if (mode === 'selection') {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8">
                <header className="text-center mb-12">
                     <div className="inline-block"><AIInpaintLogo /></div>
                    <p className="mt-4 text-lg text-center max-w-2xl text-[var(--text-secondary)]">
                        Công cụ chỉnh sửa và đổi màu ảnh chuyên nghiệp sử dụng AI.
                    </p>
                </header>
                
                <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div 
                        className={`relative panel flex flex-col items-center justify-center text-center p-8 transition-all duration-300 ${isDraggingOver ? 'ring-4 ring-[var(--accent-primary-start)]' : ''}`}
                        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop(handleEditDrop)}
                        style={{minHeight: '300px'}}
                    >
                        <PhotoIcon />
                        <h2 className="text-2xl font-bold mt-4 text-[var(--text-primary)]">Chỉnh sửa ảnh</h2>
                        <p className="mt-2 text-[var(--text-secondary)]">Tải lên một ảnh để chỉnh sửa, xóa vật thể hoặc thay đổi chi tiết bằng AI.</p>
                        <label className="btn btn-primary mt-6 cursor-pointer">
                            <span>Chọn ảnh</span>
                            <input type="file" className="hidden" accept="image/*" onChange={handleFileSelectForEdit} />
                        </label>
                         <p className="text-sm mt-4 text-[var(--text-tertiary)]">hoặc kéo và thả ảnh vào đây</p>
                    </div>

                    <div 
                        className={`relative panel flex flex-col items-center justify-center text-center p-8 transition-all duration-300 ${isDraggingOver ? 'ring-4 ring-[var(--accent-primary-start)]' : ''}`}
                        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop(handleBatchDrop)}
                        style={{minHeight: '300px'}}
                    >
                        <FolderStackIcon />
                        <h2 className="text-2xl font-bold mt-4 text-[var(--text-primary)]">Chỉnh màu hàng loạt</h2>
                        <p className="mt-2 text-[var(--text-secondary)]">Áp dụng bộ lọc màu và watermark cho nhiều ảnh cùng lúc.</p>
                        <div className="flex items-center justify-center gap-4 mt-6">
                            <label className="btn btn-primary cursor-pointer">
                                <span>Chọn thư mục</span>
                                <input type="file" className="hidden" accept="image/*" multiple webkitdirectory="" onChange={handleBatchDirectorySelect} />
                            </label>
                            <label className="btn btn-primary cursor-pointer">
                                <span>Chọn ảnh</span>
                                <input type="file" className="hidden" accept="image/*" multiple onChange={(e) => e.target.files && handleBatchFiles(Array.from(e.target.files))} />
                            </label>
                        </div>
                         <p className="text-sm mt-4 text-[var(--text-tertiary)]">hoặc kéo và thả nhiều ảnh</p>
                    </div>
                </div>
            </div>
        )
    }

    const renderBatchView = () => (
        <>
            <div className="w-full lg:w-1/3 xl:w-1/4 flex-shrink-0">
                 <div className="sticky top-6">
                    <Section title="Bộ lọc màu" icon={<FilmIcon/>}>
                        {lutGroups.map(group => (
                            <div key={group.title}>
                                <h4 className="text-sm font-semibold text-[var(--text-tertiary)] mb-3">{group.title}</h4>
                                <div className="grid grid-cols-3 gap-2">
                                    {group.luts.map(lut => (
                                        <button 
                                            key={lut.name}
                                            onClick={() => handleApplyLut(lut)}
                                            className={`p-2 text-xs font-semibold rounded-lg transition-all ${activeLut === lut.name ? 'btn-primary shadow-inner' : 'btn'}`}
                                            disabled={isBatchProcessing}
                                        >
                                            {lut.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </Section>
                    
                    <Section title="Watermark" icon={<WatermarkIcon />}>
                         <div className="flex items-start space-x-4">
                            <div 
                                className={`relative w-24 h-24 rounded-lg flex items-center justify-center text-center text-xs text-[var(--text-tertiary)] transition-all bg-[var(--bg-color)] shadow-inner ${isDraggingOver ? 'ring-2 ring-[var(--accent-primary-start)]' : ''}`}
                                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop(handleWatermarkDrop)}
                            >
                                {watermarkImage ? (
                                    <img src={watermarkImage} alt="Logo preview" className="max-w-full max-h-full object-contain p-1" />
                                ) : (
                                    <span>Tải logo</span>
                                )}
                                <input type="file" accept="image/*" onChange={(e) => e.target.files && handleWatermarkUpload(e.target.files[0])} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                            </div>
                            <div className="flex-1">
                                <label className="flex items-center space-x-2 cursor-pointer">
                                    <input type="checkbox" checked={removeLogoBg} onChange={e => setRemoveLogoBg(e.target.checked)} disabled={!originalWatermarkImage || isRemovingLogoBg} className="h-4 w-4 rounded" />
                                    <span className="text-sm font-medium text-[var(--text-secondary)]">Xóa phông (AI)</span>
                                </label>
                                <p className="text-xs text-[var(--text-tertiary)] mt-1">Tự động xóa nền khỏi logo của bạn. Yêu cầu có logo.</p>
                                {isRemovingLogoBg && <div className="text-xs text-[var(--accent-primary-start)] mt-1">Đang xử lý...</div>}
                            </div>
                        </div>
                        
                        <div>
                            <label className="text-sm font-medium text-[var(--text-secondary)] mb-2 block">Chế độ chèn</label>
                            <div className="grid grid-cols-4 gap-2">
                                {(['center', 'diagonal', 'line', 'grid'] as WatermarkMode[]).map(m => (
                                    <button
                                        key={m}
                                        onClick={() => setWatermarkSettings(s => ({ ...s, mode: m }))}
                                        className={`p-2 text-xs font-semibold rounded-lg capitalize transition-all ${watermarkSettings.mode === m ? 'btn-primary' : 'btn'}`}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        </div>
                        
                        <div className="space-y-4">
                             <div className="flex flex-col space-y-2">
                                <label className="text-sm font-medium text-[var(--text-secondary)]">Kích thước: {watermarkSettings.size}%</label>
                                <input type="range" min="1" max="100" value={watermarkSettings.size} onChange={e => setWatermarkSettings(s => ({ ...s, size: Number(e.target.value) }))} />
                            </div>
                             <div className="flex flex-col space-y-2">
                                <label className="text-sm font-medium text-[var(--text-secondary)]">Độ mờ: {watermarkSettings.opacity}%</label>
                                <input type="range" min="0" max="100" value={watermarkSettings.opacity} onChange={e => setWatermarkSettings(s => ({ ...s, opacity: Number(e.target.value) }))} />
                            </div>
                        </div>
                    </Section>
                </div>
            </div>

            <div className="w-full lg:w-2/3 xl:w-3/4 lg:pl-8">
                 <div className="panel grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                     {batchImages.map(image => (
                         <div key={image.id} className="relative aspect-square rounded-lg overflow-hidden shadow-md bg-[var(--bg-color)]">
                             <img src={image.processed || image.original} alt={image.name} className="w-full h-full object-cover" />
                             {(image.isLoading || (isBatchProcessing && !image.processed)) && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                    <SpinnerIcon />
                                </div>
                             )}
                             <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-1.5">
                                 <p className="text-white text-xs truncate">{image.name}</p>
                             </div>
                         </div>
                     ))}
                     <label className="relative aspect-square rounded-lg border-2 border-dashed border-[var(--text-tertiary)] flex flex-col items-center justify-center text-center text-[var(--text-secondary)] hover:border-[var(--text-primary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
                         <PlusIcon />
                         <span className="text-sm mt-2">Thêm ảnh</span>
                         <input type="file" multiple className="absolute inset-0 opacity-0" onChange={(e) => e.target.files && handleBatchFiles(Array.from(e.target.files))} />
                     </label>
                 </div>
            </div>
        </>
    );

    const renderEditView = () => {
        // Fix: Use React.FC to correctly type the component and its children prop.
        type TabButtonProps = { 
            isActive: boolean; 
            onClick: () => void; 
            title: string;
        };
        const TabButton: React.FC<TabButtonProps> = ({ isActive, onClick, title, children }) => (
            <button onClick={onClick} title={title} className={`flex-1 py-3 px-2 rounded-xl flex flex-col sm:flex-row items-center justify-center space-y-1 sm:space-y-0 sm:space-x-2 transition-all text-sm font-medium ${isActive ? 'shadow-concave text-[var(--accent-primary-start)]' : 'shadow-convex text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
                {children}
            </button>
        );

        type StyleButtonProps = { name: string; styleId: string; current: string | null; onClick: (styleId: string) => void; disabled: boolean; };
        const StyleButton: React.FC<StyleButtonProps> = ({ name, styleId, current, onClick, disabled }) => (
            <button
                onClick={() => onClick(styleId)}
                disabled={disabled || current === styleId}
                className="btn w-full !justify-start text-left !rounded-lg"
            >
                {disabled && current === styleId ? <SpinnerIcon /> : <div className="w-5 h-5" />}
                <span>{name}</span>
            </button>
        );

        return (
            <>
                <div className="w-full lg:w-1/3 xl:w-1/4 flex-shrink-0">
                    <div className="sticky top-6">
                        <div className="flex items-stretch justify-around gap-2 panel !p-2 mb-6">
                            <TabButton isActive={activeEditTab === 'ai'} onClick={() => setActiveEditTab('ai')} title="AI Chỉnh sửa">
                                <WandIcon /> 
                                <span className="text-xs sm:text-sm">AI</span>
                            </TabButton>
                             <TabButton isActive={activeEditTab === 'style'} onClick={() => setActiveEditTab('style')} title="Phong cách">
                                <PaletteIcon /> 
                                <span className="text-xs sm:text-sm">Phong cách</span>
                            </TabButton>
                            <TabButton isActive={activeEditTab === 'filters'} onClick={() => setActiveEditTab('filters')} title="Bộ lọc màu">
                                <FilmIcon /> 
                                <span className="text-xs sm:text-sm">Bộ lọc</span>
                            </TabButton>
                            <TabButton isActive={activeEditTab === 'adjustments'} onClick={() => setActiveEditTab('adjustments')} title="Thông số">
                                <SlidersIcon />
                                <span className="text-xs sm:text-sm">Tuỳ chỉnh</span>
                            </TabButton>
                        </div>
                        
                        {activeEditTab === 'ai' && (
                            <Section title="AI Chỉnh sửa" icon={<WandIcon/>}>
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="Mô tả thay đổi bạn muốn, ví dụ: 'thay áo khoác thành áo da màu đen'"
                                    className="w-full h-24 p-3 rounded-xl text-sm"
                                    rows={3}
                                />
                                <div className="grid grid-cols-3 gap-2">
                                    {referenceImages.map((img, index) => (
                                        <div 
                                            key={index}
                                            className={`relative aspect-square rounded-lg bg-[var(--bg-color)] shadow-inner transition-all duration-200 ${refDragOverIndex === index ? 'ring-2 ring-offset-2 ring-[var(--accent-primary-start)]' : ''}`}
                                            onDragOver={(e) => handleRefDragOver(e, index)}
                                            onDragLeave={handleRefDragLeave}
                                            onDrop={(e) => handleRefDrop(e, index)}
                                        >
                                            <label className="w-full h-full flex items-center justify-center cursor-pointer">
                                                {img ? (
                                                    <img src={img} className="w-full h-full object-cover rounded-lg" alt={`Reference ${index + 1}`} />
                                                ) : (
                                                    <PlusIcon/>
                                                )}
                                                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files && handleReferenceImageChange(e.target.files[0], index)} />
                                            </label>
                                            {img && (
                                                <button onClick={() => removeReferenceImage(index)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow-md">
                                                    <CloseIcon/>
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <p className="text-xs text-center text-[var(--text-tertiary)] -mt-2">Thêm ảnh tham chiếu (tùy chọn)</p>
                                <div className="flex flex-col space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                        <div className="flex items-center space-x-2">
                                            <BrushIcon/>
                                            <label className="text-[var(--text-secondary)] font-medium">Cọ vẽ</label>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[var(--text-tertiary)] w-8 text-right">{brushSize}</span>
                                            <button onClick={clearCanvas} title="Xóa toàn bộ vùng đã vẽ" className="btn !p-2 !rounded-lg"><EraserIcon /></button>
                                        </div>
                                    </div>
                                    <input type="range" min="1" max={maxBrushSize} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
                                    <p className="text-xs text-center text-[var(--text-tertiary)] -mt-1">Vẽ bằng chuột trái. Xóa bằng chuột phải. Giữ Alt + chuột phải để đổi kích cỡ.</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button onClick={handleRemoveObject} className="btn w-full" disabled={isLoading}>
                                        {isLoading ? <SpinnerIcon /> : <ClearIcon />}
                                        Xóa vật thể
                                    </button>
                                    <button onClick={handleGenerate} className="btn btn-primary w-full" disabled={isLoading}>
                                        {isLoading ? <SpinnerIcon /> : <WandIcon />}
                                        Tạo
                                    </button>
                                </div>
                            </Section>
                        )}

                        {activeEditTab === 'style' && (
                             <Section title="Chuyển đổi phong cách" icon={<PaletteIcon/>}>
                                <p className="text-sm text-[var(--text-secondary)] -mt-2">Biến đổi toàn bộ ảnh của bạn theo một phong cách nghệ thuật mới.</p>
                                <div className="space-y-2">
                                    <StyleButton name="Phác thảo kỹ thuật" styleId="sketch" current={activeStyle} onClick={handleStyleTransfer} disabled={isLoading} />
                                    <StyleButton name="Render 3D" styleId="3d-render" current={activeStyle} onClick={handleStyleTransfer} disabled={isLoading} />
                                    <StyleButton name="Siêu thực (Cinematic)" styleId="hyperrealistic" current={activeStyle} onClick={handleStyleTransfer} disabled={isLoading} />
                                    <div>
                                        <h4 className="text-sm font-semibold text-[var(--text-tertiary)] mb-2 mt-4">Hoạt hình</h4>
                                        <div className="grid grid-cols-2 gap-2">
                                            {(['chibi', 'anime', '3d-anim', 'claymation'] as const).map(style => (
                                                 <button key={style} onClick={() => handleStyleTransfer(style)} disabled={isLoading || activeStyle === style} className="btn text-xs !rounded-lg">
                                                     {isLoading && activeStyle === style ? <SpinnerIcon /> : null}
                                                     <span className="capitalize">{style.replace('-anim', '')}</span>
                                                 </button>
                                            ))}
                                        </div>
                                    </div>
                                    <StyleButton name="Tranh mực tàu Gongbi" styleId="gongbi" current={activeStyle} onClick={handleStyleTransfer} disabled={isLoading} />
                                </div>
                            </Section>
                        )}

                        {activeEditTab === 'filters' && (
                             <Section title="Bộ lọc màu" icon={<FilmIcon/>}>
                                {lutGroups.map(group => (
                                    <div key={group.title}>
                                        <h4 className="text-sm font-semibold text-[var(--text-tertiary)] mb-3">{group.title}</h4>
                                        <div className="grid grid-cols-3 gap-2">
                                            {group.luts.map(lut => (
                                                <button 
                                                    key={lut.name}
                                                    onClick={() => handleApplyLut(lut)}
                                                    className={`p-2 text-xs font-semibold rounded-lg transition-all ${activeLut === lut.name ? 'btn-primary shadow-inner' : 'btn'}`}
                                                >
                                                    {lut.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </Section>
                        )}
                        
                        {activeEditTab === 'adjustments' && (
                             <Section title="Tuỳ chỉnh thông số" icon={<SlidersIcon/>}>
                                <AdjustmentSlider label="Sáng" icon={<BrightnessIcon />} value={adjustments.brightness} onChange={(e) => handleAdjustmentChange('brightness', e.target.value)} min={0} max={200} defaultValue={100} onReset={() => handleResetSingleAdjustment('brightness')} />
                                <AdjustmentSlider label="Tương phản" icon={<ContrastIcon />} value={adjustments.contrast} onChange={(e) => handleAdjustmentChange('contrast', e.target.value)} min={0} max={200} defaultValue={100} onReset={() => handleResetSingleAdjustment('contrast')} />
                                <AdjustmentSlider label="Bão hòa" icon={<SaturationIcon />} value={adjustments.saturation} onChange={(e) => handleAdjustmentChange('saturation', e.target.value)} min={0} max={200} defaultValue={100} onReset={() => handleResetSingleAdjustment('saturation')} />
                                <AdjustmentSlider label="Màu sắc" icon={<HueIcon />} value={adjustments.hue} onChange={(e) => handleAdjustmentChange('hue', e.target.value)} min={-180} max={180} defaultValue={0} onReset={() => handleResetSingleAdjustment('hue')} />
                                <AdjustmentSlider label="Mờ" icon={<BlurIcon />} value={adjustments.blur} onChange={(e) => handleAdjustmentChange('blur', e.target.value)} min={0} max={20} defaultValue={0} onReset={() => handleResetSingleAdjustment('blur')} />
                                <AdjustmentSlider label="Đen trắng" icon={<GrayscaleIcon />} value={adjustments.grayscale} onChange={(e) => handleAdjustmentChange('grayscale', e.target.value)} min={0} max={100} defaultValue={0} onReset={() => handleResetSingleAdjustment('grayscale')} />
                                <AdjustmentSlider label="Nâu đỏ" icon={<SepiaIcon />} value={adjustments.sepia} onChange={(e) => handleAdjustmentChange('sepia', e.target.value)} min={0} max={100} defaultValue={0} onReset={() => handleResetSingleAdjustment('sepia')} />
                                <AdjustmentSlider label="Đảo ngược" icon={<InvertIcon />} value={adjustments.invert} onChange={(e) => handleAdjustmentChange('invert', e.target.value)} min={0} max={100} defaultValue={0} onReset={() => handleResetSingleAdjustment('invert')} />
                                <AdjustmentSlider label="Tối góc" icon={<VignetteIcon />} value={adjustments.vignette} onChange={(e) => handleAdjustmentChange('vignette', e.target.value)} min={0} max={100} defaultValue={0} onReset={() => handleResetSingleAdjustment('vignette')} />
                            </Section>
                        )}

                    </div>
                </div>

                <div className="w-full lg:w-2/3 xl:w-3/4 lg:pl-8">
                    <div className="sticky top-6">
                        <div 
                            className="relative w-full h-full min-h-[60vh] flex items-center justify-center panel"
                            onMouseEnter={handleContainerMouseEnter}
                            onMouseLeave={handleContainerMouseLeave}
                        >
                            {displayImage ? (
                                <div 
                                    className="relative cursor-crosshair"
                                    onMouseDown={handleMouseDown}
                                    onMouseMove={handleCanvasMouseMove}
                                    onContextMenu={(e) => e.preventDefault()}
                                    onDragStart={(e) => e.preventDefault()}
                                >
                                    <img ref={imageRef} src={displayImage} alt="Editable" className="max-w-full max-h-[80vh] block rounded-lg shadow-lg" style={{ filter: applyFilters(), WebkitFilter: applyFilters() }} draggable={false}/>
                                    <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full opacity-70 pointer-events-none" />
                                    <div
                                        ref={brushCursorRef}
                                        className="absolute rounded-full border-2 border-white transform -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-200 opacity-0"
                                    />
                                     {showRegenerate && !isLoading && (
                                        <button 
                                            onClick={handleRegenerate}
                                            className="btn btn-primary absolute bottom-4 right-4 z-10"
                                            title="Tạo lại với biến thể khác"
                                        >
                                            <RegenerateIcon />
                                            Tạo lại
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <p>Tải ảnh lên để bắt đầu chỉnh sửa</p>
                            )}
                        </div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <div className="min-h-screen p-4 sm:p-6 lg:p-8 pb-16">
            <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
                <div className="flex items-center space-x-4">
                    <button onClick={handleNewImage} className="btn"><BackIcon /> Quay lại</button>
                    <h1 className="text-xl font-bold text-[var(--text-secondary)]">{mode === 'edit' ? 'Chỉnh sửa ảnh' : 'Chỉnh màu hàng loạt'}</h1>
                </div>

                <div className="flex items-center space-x-2">
                   {mode === 'edit' && <>
                        <button onClick={handleUndo} disabled={!undoState || isLoading} className="btn"><UndoIcon /> Hoàn tác</button>
                        <button onClick={handleRedo} disabled={!isRedo || isLoading} className="btn"><RedoIcon /> Làm lại</button>
                        <button onClick={handleDownload} disabled={!displayImage || isLoading} className="btn btn-success"><DownloadIcon /> Tải xuống</button>
                    </>}
                    {mode === 'batch' && <>
                         <button onClick={() => setBatchImages([])} disabled={batchImages.length === 0 || isBatchProcessing} className="btn"><ClearIcon /> Xóa tất cả</button>
                         <button onClick={handleDownloadBatch} disabled={batchImages.every(img => !img.processed) || isBatchProcessing} className="btn btn-success">
                             {isBatchProcessing ? <SpinnerIcon /> : <DownloadIcon />}
                             Tải ZIP
                         </button>
                    </>}
                </div>
            </header>

            <main className="flex flex-col lg:flex-row">
                {mode === 'edit' ? renderEditView() : renderBatchView()}
            </main>
            
            <footer className="fixed bottom-0 left-0 right-0 z-10 bg-[var(--bg-color)]/80 backdrop-blur-sm text-center py-2 text-sm text-[var(--text-secondary)] font-medium shadow-[0_-2px_10px_var(--shadow-dark)]">
                {status}
            </footer>
        </div>
    );
}

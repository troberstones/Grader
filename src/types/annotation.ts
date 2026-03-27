export interface AnnotationFrame {
  frameNumber: number | null; // null for images
  data: string; // Fabric.js JSON string
}

export interface AnnotationSet {
  submissionId: number;
  frames: AnnotationFrame[];
}

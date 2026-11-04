import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PRESIGN_DOWNLOAD_SECONDS, PRESIGN_UPLOAD_SECONDS } from "./artifacts.js";

// Presigned URLs are signed with the BFF's own IRSA credentials. Only the BFF decides which keys
// are signed; browsers never choose an object key.
export class ArtifactStorage {
  private readonly client: S3Client;

  constructor(private readonly bucket: string, client?: S3Client) {
    this.client = client ?? new S3Client({});
  }

  async presignUpload(objectKey: string, contentType: string, sizeBytes: number): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGN_UPLOAD_SECONDS });
  }

  async presignDownload(objectKey: string, fileName: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, "")}"`,
    });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGN_DOWNLOAD_SECONDS });
  }

  // Returns the stored size, or null when the object was never uploaded.
  async headObjectSize(objectKey: string): Promise<number | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return typeof result.ContentLength === "number" ? result.ContentLength : null;
    } catch (error) {
      if (error instanceof Error && (error.name === "NotFound" || error.name === "NoSuchKey")) return null;
      throw error;
    }
  }
}

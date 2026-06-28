import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import type { MediaStore, PutResult } from "./store.js";

const cfg = env.media.s3;

export class S3MediaStore implements MediaStore {
  readonly kind = "s3" as const;
  private client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: cfg.forcePathStyle,
      credentials:
        cfg.accessKeyId && cfg.secretAccessKey
          ? {
              accessKeyId: cfg.accessKeyId,
              secretAccessKey: cfg.secretAccessKey,
            }
          : undefined,
    });
  }

  async init(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
      console.log(`[media] created bucket ${cfg.bucket}`);
    }
    // Anonymous read so Instagram's fetchers can GET the objects.
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicRead",
          Effect: "Allow",
          Principal: "*",
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${cfg.bucket}/*`],
        },
      ],
    };
    try {
      await this.client.send(
        new PutBucketPolicyCommand({
          Bucket: cfg.bucket,
          Policy: JSON.stringify(policy),
        }),
      );
    } catch (e) {
      console.warn(
        `[media] could not set public-read policy on ${cfg.bucket}:`,
        (e as Error).message,
      );
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<PutResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key, url: `${cfg.publicBaseUrl}/${key}` };
  }

  async deletePrefix(prefix: string): Promise<void> {
    let continuationToken: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));
      // DeleteObjects is capped at 1000 keys per request; ListObjectsV2 already
      // returns at most 1000, so one delete per page is sufficient.
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: cfg.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }
}

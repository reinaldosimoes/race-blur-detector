const mockNativeImage = {
  createFromPath: jest.fn((filePath) => {
    const fsCheck = require("fs");
    if (!fsCheck.existsSync(filePath)) {
      return { isEmpty: () => true };
    }
    const buf = fsCheck.readFileSync(filePath);
    if (buf.length < 2 || buf[0] !== 0xFF || buf[1] !== 0xD8) {
      return { isEmpty: () => true };
    }
    return {
      isEmpty: () => false,
      resize: () => ({
        toPNG: () => Buffer.from([0x89, 0x50, 0x4E, 0x47]),
      }),
    };
  }),
};

jest.mock("electron", () => ({
  app: { whenReady: () => ({ then: () => {} }), on: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => {} },
  dialog: {},
  nativeImage: mockNativeImage,
}));

const fs = require("fs");
const path = require("path");
const os = require("os");
const { scanJpegs, readFileBase64, validateJpeg, moveToReview, scanMultipleFolders, estimateScanTime, generateThumbnail } = require("./main");

// Minimal valid JPEG: FFD8 header + FFD9 footer
const VALID_JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x02, 0x00, 0x00, 0xFF, 0xD9]);

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rbd-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scanJpegs", () => {
  test("returns valid JPEG files", async () => {
    fs.writeFileSync(path.join(tmpDir, "photo1.jpg"), VALID_JPEG);
    fs.writeFileSync(path.join(tmpDir, "photo2.jpeg"), VALID_JPEG);

    const result = await scanJpegs(tmpDir);
    const names = result.map((f) => f.name).sort();
    expect(names).toEqual(["photo1.jpg", "photo2.jpeg"]);
  });

  test("skips 0-byte files", async () => {
    fs.writeFileSync(path.join(tmpDir, "empty.jpg"), "");
    fs.writeFileSync(path.join(tmpDir, "valid.jpg"), VALID_JPEG);

    const result = await scanJpegs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("valid.jpg");
  });

  test("skips hidden files", async () => {
    fs.writeFileSync(path.join(tmpDir, ".hidden.jpg"), VALID_JPEG);
    fs.writeFileSync(path.join(tmpDir, "visible.jpg"), VALID_JPEG);

    const result = await scanJpegs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("visible.jpg");
  });

  test("skips non-JPEG extensions", async () => {
    fs.writeFileSync(path.join(tmpDir, "photo.png"), VALID_JPEG);
    fs.writeFileSync(path.join(tmpDir, "photo.txt"), "hello");
    fs.writeFileSync(path.join(tmpDir, "photo.jpg"), VALID_JPEG);

    const result = await scanJpegs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("photo.jpg");
  });

  test("returns error for non-existent folder", async () => {
    const result = await scanJpegs("/nonexistent/path/12345");
    expect(result).toHaveProperty("error");
  });

  test("handles case-insensitive extensions (.JPG, .JPEG)", async () => {
    fs.writeFileSync(path.join(tmpDir, "upper.JPG"), VALID_JPEG);
    fs.writeFileSync(path.join(tmpDir, "mixed.JpEg"), VALID_JPEG);

    const result = await scanJpegs(tmpDir);
    const names = result.map((f) => f.name).sort();
    expect(names).toEqual(["mixed.JpEg", "upper.JPG"]);
  });

  test("returns empty array for empty directory", async () => {
    const result = await scanJpegs(tmpDir);
    expect(result).toEqual([]);
  });

  test("skips subdirectories even if named like JPEGs", async () => {
    fs.mkdirSync(path.join(tmpDir, "photos.jpg"));
    fs.writeFileSync(path.join(tmpDir, "real.jpg"), VALID_JPEG);

    const result = await scanJpegs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("real.jpg");
  });

  test("includes full path in each result", async () => {
    fs.writeFileSync(path.join(tmpDir, "photo.jpg"), VALID_JPEG);

    const result = await scanJpegs(tmpDir);
    expect(result[0].path).toBe(path.join(tmpDir, "photo.jpg"));
  });

  test("skips files with JPEG-like but wrong extensions", async () => {
    fs.writeFileSync(path.join(tmpDir, "file.jpgg"), VALID_JPEG);
    fs.writeFileSync(path.join(tmpDir, "file.jpg2"), VALID_JPEG);
    fs.writeFileSync(path.join(tmpDir, "file.jpe"), VALID_JPEG);

    const result = await scanJpegs(tmpDir);
    // .jpe matches /\.(jpe?g)$/i since "jpe" doesn't match (needs g)
    expect(result).toHaveLength(0);
  });

  test("handles many files", async () => {
    for (let i = 0; i < 50; i++) {
      fs.writeFileSync(path.join(tmpDir, `photo_${i}.jpg`), VALID_JPEG);
    }

    const result = await scanJpegs(tmpDir);
    expect(result).toHaveLength(50);
  });
});

describe("readFileBase64", () => {
  test("returns base64 for valid JPEG", async () => {
    const filePath = path.join(tmpDir, "valid.jpg");
    fs.writeFileSync(filePath, VALID_JPEG);

    const result = await readFileBase64(filePath);
    expect(typeof result).toBe("string");
    // Decode and verify it matches
    const decoded = Buffer.from(result, "base64");
    expect(decoded[0]).toBe(0xFF);
    expect(decoded[1]).toBe(0xD8);
  });

  test("rejects file without JPEG magic bytes", async () => {
    const filePath = path.join(tmpDir, "fake.jpg");
    fs.writeFileSync(filePath, "this is not a jpeg");

    const result = await readFileBase64(filePath);
    expect(result).toEqual({ error: "not a valid JPEG" });
  });

  test("rejects PNG file with .jpg extension", async () => {
    const filePath = path.join(tmpDir, "actually-png.jpg");
    // PNG magic bytes
    fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));

    const result = await readFileBase64(filePath);
    expect(result).toEqual({ error: "not a valid JPEG" });
  });

  test("rejects empty/tiny files", async () => {
    const filePath = path.join(tmpDir, "tiny.jpg");
    fs.writeFileSync(filePath, Buffer.from([0xFF]));

    const result = await readFileBase64(filePath);
    expect(result).toEqual({ error: "not a valid JPEG" });
  });

  test("returns error for non-existent file", async () => {
    const result = await readFileBase64(path.join(tmpDir, "nope.jpg"));
    expect(result).toHaveProperty("error");
  });

  test("rejects GIF with .jpg extension", async () => {
    const filePath = path.join(tmpDir, "actually-gif.jpg");
    // GIF87a magic bytes
    fs.writeFileSync(filePath, Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]));

    const result = await readFileBase64(filePath);
    expect(result).toEqual({ error: "not a valid JPEG" });
  });

  test("rejects BMP with .jpg extension", async () => {
    const filePath = path.join(tmpDir, "actually-bmp.jpg");
    // BMP magic bytes
    fs.writeFileSync(filePath, Buffer.from([0x42, 0x4D, 0x00, 0x00]));

    const result = await readFileBase64(filePath);
    expect(result).toEqual({ error: "not a valid JPEG" });
  });

  test("returns correct base64 that round-trips", async () => {
    const filePath = path.join(tmpDir, "roundtrip.jpg");
    fs.writeFileSync(filePath, VALID_JPEG);

    const b64 = await readFileBase64(filePath);
    const decoded = Buffer.from(b64, "base64");
    expect(decoded).toEqual(VALID_JPEG);
  });

  test("rejects file with 0xFF as first byte but wrong second byte", async () => {
    const filePath = path.join(tmpDir, "almost.jpg");
    fs.writeFileSync(filePath, Buffer.from([0xFF, 0x00, 0xFF, 0xD9]));

    const result = await readFileBase64(filePath);
    expect(result).toEqual({ error: "not a valid JPEG" });
  });

  test("handles JPEG with only the 2-byte header", async () => {
    const filePath = path.join(tmpDir, "minimal.jpg");
    fs.writeFileSync(filePath, Buffer.from([0xFF, 0xD8]));

    const result = await readFileBase64(filePath);
    // Should succeed — only header check is the first 2 bytes
    expect(typeof result).toBe("string");
  });

  test("rejects completely empty file", async () => {
    const filePath = path.join(tmpDir, "empty.jpg");
    fs.writeFileSync(filePath, Buffer.alloc(0));

    const result = await readFileBase64(filePath);
    expect(result).toEqual({ error: "not a valid JPEG" });
  });

  test("rejects WebP with .jpg extension", async () => {
    const filePath = path.join(tmpDir, "actually-webp.jpg");
    // RIFF....WEBP magic bytes
    fs.writeFileSync(filePath, Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]));

    const result = await readFileBase64(filePath);
    expect(result).toEqual({ error: "not a valid JPEG" });
  });
});

describe("validateJpeg", () => {
  test("returns valid for JPEG file", async () => {
    const filePath = path.join(tmpDir, "good.jpg");
    fs.writeFileSync(filePath, VALID_JPEG);

    const result = await validateJpeg(filePath);
    expect(result).toEqual({ valid: true });
  });

  test("returns invalid for non-JPEG file", async () => {
    const filePath = path.join(tmpDir, "fake.jpg");
    fs.writeFileSync(filePath, "not a jpeg");

    const result = await validateJpeg(filePath);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("not a valid JPEG");
  });

  test("returns invalid for PNG with .jpg extension", async () => {
    const filePath = path.join(tmpDir, "png.jpg");
    fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4E, 0x47]));

    const result = await validateJpeg(filePath);
    expect(result.valid).toBe(false);
  });

  test("returns error for non-existent file", async () => {
    const result = await validateJpeg(path.join(tmpDir, "missing.jpg"));
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty("error");
  });

  test("returns invalid for empty file", async () => {
    const filePath = path.join(tmpDir, "empty.jpg");
    fs.writeFileSync(filePath, Buffer.alloc(0));

    const result = await validateJpeg(filePath);
    expect(result.valid).toBe(false);
  });

  test("returns invalid for single-byte file", async () => {
    const filePath = path.join(tmpDir, "onebyte.jpg");
    fs.writeFileSync(filePath, Buffer.from([0xFF]));

    const result = await validateJpeg(filePath);
    expect(result.valid).toBe(false);
  });

  test("returns invalid for GIF file", async () => {
    const filePath = path.join(tmpDir, "gif.jpg");
    fs.writeFileSync(filePath, Buffer.from([0x47, 0x49, 0x46, 0x38]));

    const result = await validateJpeg(filePath);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("not a valid JPEG");
  });

  test("returns valid for minimal JPEG header", async () => {
    const filePath = path.join(tmpDir, "minimal.jpg");
    fs.writeFileSync(filePath, Buffer.from([0xFF, 0xD8]));

    const result = await validateJpeg(filePath);
    expect(result).toEqual({ valid: true });
  });

  test("returns invalid for directory path", async () => {
    const dirPath = path.join(tmpDir, "subdir");
    fs.mkdirSync(dirPath);

    const result = await validateJpeg(dirPath);
    // Should fail since you can't read a directory as a file
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty("error");
  });

  test("returns invalid for all-zero bytes", async () => {
    const filePath = path.join(tmpDir, "zeros.jpg");
    fs.writeFileSync(filePath, Buffer.alloc(100));

    const result = await validateJpeg(filePath);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("not a valid JPEG");
  });

  test("returns valid for symlink to valid JPEG", async () => {
    const realPath = path.join(tmpDir, "real.jpg");
    const linkPath = path.join(tmpDir, "link.jpg");
    fs.writeFileSync(realPath, VALID_JPEG);
    fs.symlinkSync(realPath, linkPath);

    const result = await validateJpeg(linkPath);
    expect(result).toEqual({ valid: true });
  });
});

describe("moveToReview", () => {
  test("moves files to a new review subfolder", async () => {
    const file1 = path.join(tmpDir, "a.jpg");
    const file2 = path.join(tmpDir, "b.jpg");
    fs.writeFileSync(file1, VALID_JPEG);
    fs.writeFileSync(file2, VALID_JPEG);

    const result = await moveToReview({
      files: [file1, file2],
      sourceFolder: tmpDir,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.success)).toBe(true);
    expect(fs.existsSync(path.join(result.reviewDir, "a.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(result.reviewDir, "b.jpg"))).toBe(true);
  });

  test("uses default folder name 'review_blurry' when not provided", async () => {
    const file = path.join(tmpDir, "photo.jpg");
    fs.writeFileSync(file, VALID_JPEG);

    const result = await moveToReview({
      files: [file],
      sourceFolder: tmpDir,
    });

    expect(result.reviewDir).toBe(path.join(tmpDir, "review_blurry"));
  });

  test("uses custom folder name when provided", async () => {
    const file = path.join(tmpDir, "photo.jpg");
    fs.writeFileSync(file, VALID_JPEG);

    const result = await moveToReview({
      files: [file],
      sourceFolder: tmpDir,
      reviewFolderName: "my_review",
    });

    expect(result.reviewDir).toBe(path.join(tmpDir, "my_review"));
    expect(fs.existsSync(path.join(tmpDir, "my_review", "photo.jpg"))).toBe(true);
  });

  test("returns { reviewDir, results } with per-file success", async () => {
    const file = path.join(tmpDir, "photo.jpg");
    fs.writeFileSync(file, VALID_JPEG);

    const result = await moveToReview({
      files: [file],
      sourceFolder: tmpDir,
    });

    expect(result).toHaveProperty("reviewDir");
    expect(result).toHaveProperty("results");
    expect(result.results[0]).toEqual({ file: "photo.jpg", success: true });
  });

  test("handles non-existent source files gracefully", async () => {
    const missing = path.join(tmpDir, "ghost.jpg");

    const result = await moveToReview({
      files: [missing],
      sourceFolder: tmpDir,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0]).toHaveProperty("error");
  });

  test("moves some files successfully even when others fail", async () => {
    const good = path.join(tmpDir, "good.jpg");
    const missing = path.join(tmpDir, "missing.jpg");
    fs.writeFileSync(good, VALID_JPEG);

    const result = await moveToReview({
      files: [good, missing],
      sourceFolder: tmpDir,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ file: "good.jpg", success: true });
    expect(result.results[1].success).toBe(false);
  });

  test("handles empty files array", async () => {
    const result = await moveToReview({
      files: [],
      sourceFolder: tmpDir,
    });

    expect(result.results).toEqual([]);
    expect(result).toHaveProperty("reviewDir");
  });

  test("moves into existing review directory without error", async () => {
    const reviewDir = path.join(tmpDir, "review_blurry");
    fs.mkdirSync(reviewDir);
    const file = path.join(tmpDir, "photo.jpg");
    fs.writeFileSync(file, VALID_JPEG);

    const result = await moveToReview({
      files: [file],
      sourceFolder: tmpDir,
    });

    expect(result.reviewDir).toBe(reviewDir);
    expect(result.results[0].success).toBe(true);
  });

  test("returns correct reviewDir path", async () => {
    const result = await moveToReview({
      files: [],
      sourceFolder: tmpDir,
      reviewFolderName: "custom_dir",
    });

    expect(result.reviewDir).toBe(path.join(tmpDir, "custom_dir"));
  });
});

describe("scanJpegs edge cases", () => {
  test("filenames with spaces and special characters", async () => {
    fs.writeFileSync(path.join(tmpDir, "my photo (1).jpg"), VALID_JPEG);
    fs.writeFileSync(path.join(tmpDir, "café & résumé.jpeg"), VALID_JPEG);

    const result = await scanJpegs(tmpDir);
    expect(result).toHaveLength(2);
    const names = result.map((f) => f.name).sort();
    expect(names).toEqual(["café & résumé.jpeg", "my photo (1).jpg"]);
  });

  test("symlinks to JPEG files are included when isFile() returns true", async () => {
    const realPath = path.join(tmpDir, "real.jpg");
    const linkPath = path.join(tmpDir, "link.jpg");
    fs.writeFileSync(realPath, VALID_JPEG);
    fs.symlinkSync(realPath, linkPath);

    const result = await scanJpegs(tmpDir);
    const names = result.map((f) => f.name).sort();
    expect(names).toContain("real.jpg");
  });
});

describe("readFileBase64 edge cases", () => {
  test("symlink to a valid JPEG returns base64", async () => {
    const realPath = path.join(tmpDir, "real.jpg");
    const linkPath = path.join(tmpDir, "link.jpg");
    fs.writeFileSync(realPath, VALID_JPEG);
    fs.symlinkSync(realPath, linkPath);

    const result = await readFileBase64(linkPath);
    expect(typeof result).toBe("string");
    const decoded = Buffer.from(result, "base64");
    expect(decoded[0]).toBe(0xFF);
    expect(decoded[1]).toBe(0xD8);
  });
});

describe("scanMultipleFolders", () => {
  test("merges JPEGs from two folders into one array", async () => {
    const dir1 = path.join(tmpDir, "folder1");
    const dir2 = path.join(tmpDir, "folder2");
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);
    fs.writeFileSync(path.join(dir1, "a.jpg"), VALID_JPEG);
    fs.writeFileSync(path.join(dir2, "b.jpg"), VALID_JPEG);

    const result = await scanMultipleFolders([dir1, dir2]);
    const names = result.map((f) => f.name).sort();
    expect(names).toEqual(["a.jpg", "b.jpg"]);
  });

  test("returns empty array when all folders are empty", async () => {
    const dir1 = path.join(tmpDir, "empty1");
    const dir2 = path.join(tmpDir, "empty2");
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);

    const result = await scanMultipleFolders([dir1, dir2]);
    expect(result).toEqual([]);
  });

  test("skips non-existent folders, returns results from valid ones", async () => {
    const dir1 = path.join(tmpDir, "exists");
    fs.mkdirSync(dir1);
    fs.writeFileSync(path.join(dir1, "photo.jpg"), VALID_JPEG);

    const result = await scanMultipleFolders([dir1, "/nonexistent/path/xyz"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("photo.jpg");
  });

  test("includes same-named files from different folders (no dedup)", async () => {
    const dir1 = path.join(tmpDir, "folderA");
    const dir2 = path.join(tmpDir, "folderB");
    fs.mkdirSync(dir1);
    fs.mkdirSync(dir2);
    fs.writeFileSync(path.join(dir1, "photo.jpg"), VALID_JPEG);
    fs.writeFileSync(path.join(dir2, "photo.jpg"), VALID_JPEG);

    const result = await scanMultipleFolders([dir1, dir2]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("photo.jpg");
    expect(result[1].name).toBe("photo.jpg");
  });

  test("works with single folder (same as scanJpegs)", async () => {
    const dir = path.join(tmpDir, "single");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "test.jpg"), VALID_JPEG);

    const result = await scanMultipleFolders([dir]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test.jpg");
  });

  test("returns empty array for empty input array", async () => {
    const result = await scanMultipleFolders([]);
    expect(result).toEqual([]);
  });
});

describe("estimateScanTime", () => {
  test('returns "< 10 sec" for small estimates', () => {
    const result = estimateScanTime(5, 500);
    expect(result.formatted).toBe("< 10 sec");
  });

  test('returns "~30 sec" for ~30s estimate', () => {
    const result = estimateScanTime(30, 1000);
    expect(result.formatted).toBe("~30 sec");
  });

  test('returns "~2 min" for ~120s estimate', () => {
    const result = estimateScanTime(120, 1000);
    expect(result.formatted).toBe("~2 min");
  });

  test("returns 0 estimatedMs for 0 remaining files", () => {
    const result = estimateScanTime(0, 500);
    expect(result.estimatedMs).toBe(0);
  });

  test("handles large file counts", () => {
    const result = estimateScanTime(1000, 500);
    expect(result.estimatedMs).toBe(500000);
    expect(result.formatted).toBe("~8 min");
  });

  test("calculates correctly: 20 files * 500ms = 10000ms", () => {
    const result = estimateScanTime(20, 500);
    expect(result.estimatedMs).toBe(10000);
    expect(result.formatted).toBe("~30 sec");
  });
});

describe("generateThumbnail", () => {
  test("returns a base64 data URL string for a valid JPEG", () => {
    const filePath = path.join(tmpDir, "thumb.jpg");
    fs.writeFileSync(filePath, VALID_JPEG);

    const result = generateThumbnail(filePath, 200);
    expect(typeof result).toBe("string");
    expect(result.startsWith("data:image/png;base64,")).toBe(true);
  });

  test("returns error for non-existent file", () => {
    const result = generateThumbnail(path.join(tmpDir, "nope.jpg"), 200);
    expect(result).toHaveProperty("error");
  });

  test("returns error for invalid file", () => {
    const filePath = path.join(tmpDir, "invalid.jpg");
    fs.writeFileSync(filePath, "not an image");

    const result = generateThumbnail(filePath, 200);
    expect(result).toHaveProperty("error");
  });
});

describe("moveToReview with destFolder", () => {
  test("uses destFolder directly when provided", async () => {
    const destDir = path.join(tmpDir, "custom_dest");
    const file = path.join(tmpDir, "photo.jpg");
    fs.writeFileSync(file, VALID_JPEG);

    const result = await moveToReview({
      files: [file],
      sourceFolder: tmpDir,
      reviewFolderName: "review_blurry",
      destFolder: destDir,
    });

    expect(result.reviewDir).toBe(destDir);
    expect(fs.existsSync(path.join(destDir, "photo.jpg"))).toBe(true);
  });

  test("falls back to sourceFolder + reviewFolderName when destFolder is absent", async () => {
    const file = path.join(tmpDir, "photo.jpg");
    fs.writeFileSync(file, VALID_JPEG);

    const result = await moveToReview({
      files: [file],
      sourceFolder: tmpDir,
      reviewFolderName: "review_blurry",
    });

    expect(result.reviewDir).toBe(path.join(tmpDir, "review_blurry"));
  });

  test("creates destFolder if it doesn't exist", async () => {
    const destDir = path.join(tmpDir, "new_folder");
    const file = path.join(tmpDir, "photo.jpg");
    fs.writeFileSync(file, VALID_JPEG);

    await moveToReview({
      files: [file],
      sourceFolder: tmpDir,
      destFolder: destDir,
    });

    expect(fs.existsSync(destDir)).toBe(true);
  });

  test("moves files into specified destFolder", async () => {
    const destDir = path.join(tmpDir, "output");
    const file1 = path.join(tmpDir, "a.jpg");
    const file2 = path.join(tmpDir, "b.jpg");
    fs.writeFileSync(file1, VALID_JPEG);
    fs.writeFileSync(file2, VALID_JPEG);

    const result = await moveToReview({
      files: [file1, file2],
      sourceFolder: tmpDir,
      destFolder: destDir,
    });

    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.success)).toBe(true);
    expect(fs.existsSync(path.join(destDir, "a.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(destDir, "b.jpg"))).toBe(true);
  });
});

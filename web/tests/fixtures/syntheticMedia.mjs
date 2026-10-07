// Repository-authored synthetic bytes, generated without external media or codecs.
export function createSyntheticJpeg() {
    function segment(marker, payload) {
        const header = Buffer.from([0xff, marker, 0, 0]);
        header.writeUInt16BE(payload.length + 2, 2);
        return Buffer.concat([header, Buffer.from(payload)]);
    }
    // One grayscale pixel. Its single block has zero DC/AC coefficients.
    // Each Huffman table has one one-bit code: DC category 0 and AC end-of-block.
    const codeLengths = [1, ...Array(15).fill(0)];
    return Buffer.concat([
        Buffer.from([0xff, 0xd8]),
        segment(0xdb, [0, ...Array(64).fill(1)]),
        segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
        segment(0xc4, [0, ...codeLengths, 0, 0x10, ...codeLengths, 0]),
        segment(0xda, [1, 1, 0, 0, 63, 0]),
        Buffer.from([0x3f, 0xff, 0xd9]), // DC 0, end-of-block, padding, end-of-image.
    ]);
}

export function createSilentWav() {
    const sampleRate = 16000;
    const sampleCount = 160; // 10 ms of silence, 16-bit mono PCM.
    const bytesPerSample = 2;
    const dataSize = sampleCount * bytesPerSample;
    const wav = Buffer.alloc(44 + dataSize);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); // PCM.
    wav.writeUInt16LE(1, 22); // Mono.
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
    wav.writeUInt16LE(bytesPerSample, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(dataSize, 40);
    return wav;
}

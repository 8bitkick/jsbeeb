define([], function () {
    "use strict";
    // Some info:
    // http://www.playvectrex.com/designit/lecture/UP12.HTM
    // https://books.google.com/books?id=wUecAQAAQBAJ&pg=PA431&lpg=PA431&dq=acia+tdre&source=bl&ots=mp-yF-mK-P&sig=e6aXkFRfiIOb57WZmrvdIGsCooI&hl=en&sa=X&ei=0g2fVdDyFIXT-QG8-JD4BA&ved=0CCwQ6AEwAw#v=onepage&q=acia%20tdre&f=false
    return function Acia(cpu, toneGen, scheduler, rs423Handler) {
        var self = this;
        self.sr = 0x02;
        self.cr = 0x00;
        self.dr = 0x00;
        self.rs423Handler = rs423Handler;
        self.rs423Selected = false;
        self.motorOn = false;
        // TODO: set clearToSend accordingly; at the moment it stays low.
        // would need to be updated based on the "other end" of the link, and
        // we would need to generate IRQs appropriately when TDRE goes high.
        self.clearToSend = false;

        function updateIrq() {
            if (self.sr & self.cr & 0x80) {
                cpu.interrupt |= 0x04;
            } else {
                cpu.interrupt &= ~0x04;
            }
        }

        self.reset = function () {
            self.sr = (self.sr & 0x08) | 0x06;
            updateIrq();
        };
        self.reset();

        self.tone = function (freq) {
            if (!freq) toneGen.mute();
            else toneGen.tone(freq);
        };

        self.setMotor = function (on) {
            if (on && !self.motorOn)
                run();
            else {
                toneGen.mute();
                self.runTask.cancel();
            }
            self.motorOn = on;
        };

        self.read = function (addr) {
            if (addr & 1) {
                self.sr &= ~0x81;
                updateIrq();
                return self.dr;
            } else {
                var result = (self.sr & 0x7f) | (self.sr & self.cr & 0x80);
                if (!self.clearToSend) result &= ~0x02; // Mask off TDRE if not CTS
                result = result | 0x02 | 0x08;
                return result;
            }
        };

        self.write = function (addr, val) {
            if (addr & 1) {
                self.sr &= ~0x02;
                // It's not clear how long this can take; it's when the shift register is loaded.
                // That could be straight away if not already tx-ing, but as we don't really tx,
                // be conservative here.
                self.txCompleteTask.reschedule(2000);
                updateIrq();
                if (self.rs423Selected && self.rs423Handler) self.rs423Handler.onTransmit(val);
            } else {
                if ((val & 0x03) === 0x03) {
                    // According to the 6850 docs writing 3 here doesn't affect any CR bits, but
                    // just resets the device.
                    self.reset();
                } else {
                    self.cr = val;
                }
            }
        };

        self.selectRs423 = function (selected) {
            self.rs423Selected = !!selected;
            if (selected) {
                self.sr &= ~0x04; // Clear DCD
            } else {
                self.sr &= ~0x08; // Clear CTS
            }
        };

        self.setDCD = function (level) {
            if (level) {
                if (self.sr & 0x04) return;
                self.sr |= 0x84;
            } else {
                self.sr &= ~0x04;
            }
            updateIrq();
        };

        self.receive = function (byte) {
            byte |= 0;
            self.dr = byte;
            self.sr |= 0x81;
            updateIrq();
        };

        self.setTape = function (tape) {
            self.tape = tape;
        };

        self.rewindTape = function () {
            if (self.tape) {
                console.log("rewinding tape");
                self.tape.rewind();
            }
        };

        var serialReceiveRate = 19200;

        self.setSerialReceive = function (rate) {
            serialReceiveRate = rate;
        };

        self.txCompleteTask = scheduler.newTask(function () {
            self.sr |= 0x02; // set the TDRE
        });

        function run() {
            if (self.tape) self.runTask.reschedule(self.tape.poll(self));
        }

        self.runTask = scheduler.newTask(run);
    };
});

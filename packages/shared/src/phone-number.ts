export class InvalidPhoneNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPhoneNumberError';
  }
}

export class PhoneNumber {
  private constructor(private readonly nationalNumber: string) {}

  static parse(input: string): PhoneNumber {
    const trimmed = input.trim();
    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');

    let national: string;
    if (hasPlus) {
      if (!digits.startsWith('91') || digits.length !== 12) {
        throw new InvalidPhoneNumberError('Only Indian (+91) mobile numbers are supported');
      }
      national = digits.slice(2);
    } else if (digits.length === 10) {
      national = digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
      national = digits.slice(1);
    } else if (digits.length === 12 && digits.startsWith('91')) {
      national = digits.slice(2);
    } else {
      throw new InvalidPhoneNumberError('Enter a 10-digit mobile number');
    }

    if (!/^[6-9]\d{9}$/.test(national)) {
      throw new InvalidPhoneNumberError('Indian mobile numbers start with 6, 7, 8 or 9');
    }
    return new PhoneNumber(national);
  }

  toE164(): string {
    return `+91${this.nationalNumber}`;
  }

  toNational(): string {
    return `${this.nationalNumber.slice(0, 5)} ${this.nationalNumber.slice(5)}`;
  }

  masked(): string {
    return `+91${this.nationalNumber.slice(0, 2)}XXXXX${this.nationalNumber.slice(7)}`;
  }

  equals(other: PhoneNumber): boolean {
    return this.nationalNumber === other.nationalNumber;
  }

  toString(): string {
    return this.masked();
  }

  toJSON(): string {
    return this.toE164();
  }
}

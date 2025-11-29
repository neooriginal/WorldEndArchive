class Node {
    constructor(value) {
        this.value = value;
        this.next = null;
    }
}

class Queue {
    constructor() {
        this.head = null;
        this.tail = null;
        this.length = 0;
    }

    enqueue(value) {
        const node = new Node(value);
        if (!this.head) {
            this.head = node;
            this.tail = node;
        } else {
            this.tail.next = node;
            this.tail = node;
        }
        this.length++;
    }

    dequeue() {
        if (!this.head) return null;
        const value = this.head.value;
        this.head = this.head.next;
        if (!this.head) {
            this.tail = null;
        }
        this.length--;
        return value;
    }

    peek() {
        if (!this.head) return null;
        return this.head.value;
    }

    get size() {
        return this.length;
    }
}

module.exports = Queue;

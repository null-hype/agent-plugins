// Worlds: a store of experimental worlds, and the first experiment that uses
// it, registered-delivery. The store (world.go) captures a directory a
// producer made as a restic snapshot, identified by its exact id, and hands it
// to a judge; the experiment (delivery.go) is one producer and one judge.
//
//	producer → World → judge → verdict
package main

type Worlds struct{}

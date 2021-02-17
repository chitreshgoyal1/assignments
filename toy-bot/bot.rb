#!/usr/bin/env ruby

require './lib/simulation'
Dir["./directions/*.rb"].each {|file| require file }


class Bot
  def initialize
    @input = ARGF
    @simulation = Simulation.new
  end

  def start
    @input.each_line do |line|
      command = parseInput(line,@simulation)
      command.execute
    end
  end

  def parseInput(input, simulation)
    sanitized_input = input.gsub(","," ").split

    command_name = sanitized_input[0]
    command_args = sanitized_input[1..-1]

    command = command_map.fetch(command_name) { Directions::Null }
    command.new(simulation: simulation, arguments: command_args)
  end

  private

  def command_map
    @_command_map ||= {
      "REPORT" => Directions::Report,
      "PLACE" => Directions::Place,
      "RIGHT" => Directions::Right,
      "LEFT" => Directions::Left,
      "MOVE" => Directions::Move,
    }
  end

end


Bot.new.start

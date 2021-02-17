require './lib/direction'

module Directions
  class Left < ::Direction
    def execute
      return unless valid?

      place_command.execute
    end

    def valid?
      @simulation.robot_placed?
    end

    private

    def place_command
      @_place_command ||= Directions::Place.new(
        simulation: @simulation,
        arguments: @simulation.next_robot_position(:left).values
      )
    end
  end
end
